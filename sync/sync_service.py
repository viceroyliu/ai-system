#!/usr/bin/env python3
"""
AI System 同步服务
- Notion → ChromaDB 向量库同步
- LM Studio AI 标题生成
- Web 监控界面
- 后台常驻，自动按 interval 同步
"""
import os
import re
import sys
import time
import yaml
import json
import hashlib
import requests
import threading
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, request, jsonify, render_template_string, Response

import chromadb

# ============ 路径配置 ============
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
CONFIG_PATH = BASE_DIR / "config/notion.yaml"
SYNC_STATE_PATH = DATA_DIR / "sync_state.json"
VECTOR_DB_PATH = DATA_DIR / "vector-db"
LOG_DIR = BASE_DIR / "logs"

NOTION_API = "https://api.notion.com/v1"

app = Flask(__name__)

@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    return response

@app.route("/", defaults={"path": ""}, methods=["OPTIONS"])
@app.route("/<path:path>", methods=["OPTIONS"])
def options_handler(path=""):
    return "", 204

# 全局状态
_service_running = False
_sync_thread = None
_lm_models_cache = []
_last_sync_result = None
_sync_lock = threading.Lock()  # 防止手动触发和后台线程并发同步

# 进程内单例 ChromaDB 客户端。
# ChromaDB 1.x 的 Rust 内核在进程内维护「路径->system」全局注册表，
# 多线程各自 PersistentClient(同一路径) 会触发竞态，报
# 'RustBindingsAPI' object has no attribute 'bindings' 或 KeyError(path)。
# 因此整个进程只允许存在一个客户端实例。
_chroma_client = None
_chroma_client_lock = threading.Lock()


def get_chroma():
    """返回进程内单例 ChromaDB 客户端（线程安全）。"""
    global _chroma_client
    if _chroma_client is None:
        with _chroma_client_lock:
            if _chroma_client is None:
                VECTOR_DB_PATH.mkdir(parents=True, exist_ok=True)
                _chroma_client = chromadb.PersistentClient(path=str(VECTOR_DB_PATH))
    return _chroma_client


def get_knowledge_collection():
    """返回 knowledge collection（基于单例客户端）。"""
    return get_chroma().get_or_create_collection("knowledge")


# ============ 日志 ============
def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    try:
        print(line, flush=True)
    except OSError:
        pass  # nohup 后台场景 stdout 管道断开时忽略，不让它崩掉同步
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_DIR / "sync.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ============ 工具函数 ============
def format_uuid(raw_id):
    if isinstance(raw_id, dict):
        raw_id = raw_id.get("id", "")
    clean_id = raw_id.replace("-", "")
    if len(clean_id) == 32:
        return f"{clean_id[:8]}-{clean_id[8:12]}-{clean_id[12:16]}-{clean_id[16:20]}-{clean_id[20:]}"
    return raw_id


def load_config():
    if not CONFIG_PATH.exists():
        return None
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_state():
    if SYNC_STATE_PATH.exists():
        try:
            with open(SYNC_STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"last_sync": None, "note_mapping": {}}


def save_state(state):
    with open(SYNC_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def ensure_utc(dt_str):
    """将 ISO 字符串统一为 UTC naive datetime 用于比较"""
    if not dt_str:
        return None
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt.replace(tzinfo=None)
    except Exception:
        return None


# ============ Notion 同步核心 ============
class NotionSync:
    def __init__(self, config):
        self.config = config
        self.token = config["notion"]["token"]
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
        }

        # ChromaDB 向量库（进程内单例，避免多线程重复创建）
        self.chroma = get_chroma()
        self.collection = get_knowledge_collection()

        # LM Studio / Ollama 配置
        lm_cfg = config.get("lm_studio", {})
        self.lm_url = lm_cfg.get("url", "http://localhost:1234/v1")
        self.default_model = lm_cfg.get("default_model", "qwen2.5:14b-instruct")

    # ---- Notion API ----
    def query_database_all(self, db_id):
        formatted_id = format_uuid(db_id)
        url = f"{NOTION_API}/databases/{formatted_id}/query"
        all_pages = []
        has_more = True
        start_cursor = None

        while has_more:
            payload = {}
            if start_cursor:
                payload["start_cursor"] = start_cursor
            try:
                resp = requests.post(url, headers=self.headers, json=payload, timeout=30)
                if resp.status_code != 200:
                    log(f"    ❌ API 错误: {resp.status_code} {resp.text[:100]}")
                    break
                data = resp.json()
                all_pages.extend(data.get("results", []))
                has_more = data.get("has_more", False)
                start_cursor = data.get("next_cursor")
            except Exception as e:
                log(f"    ❌ 查询失败: {e}")
                break
        return all_pages

    def get_page_content(self, page_id):
        try:
            url = f"{NOTION_API}/blocks/{page_id}/children"
            resp = requests.get(url, headers=self.headers, timeout=30)
            if resp.status_code != 200:
                return ""
            blocks = resp.json().get("results", [])
            content = []
            for block in blocks:
                bt = block.get("type", "")
                if bt in ["paragraph", "heading_1", "heading_2", "heading_3",
                          "bulleted_list_item", "numbered_list_item", "to_do"]:
                    rich = block.get(bt, {}).get("rich_text", [])
                    text = "".join(t.get("plain_text", "") for t in rich)
                    if text:
                        content.append(text)
            return "\n".join(content)
        except Exception:
            return ""

    def get_page_title(self, page):
        for key, val in page.get("properties", {}).items():
            if val.get("type") == "title":
                arr = val.get("title", [])
                if arr:
                    return arr[0].get("plain_text", "")
        return ""

    def find_title_property(self, page):
        for key, val in page.get("properties", {}).items():
            if val.get("type") == "title":
                return key
        return "名称"

    # ---- 获取可用模型（优先 default，否则取 LM Studio 第一个已加载的）----
    def _resolve_model(self, model=None):
        model = model or self.default_model
        try:
            resp = requests.post(
                f"{self.lm_url}/chat/completions",
                json={"model": model, "messages": [{"role": "user", "content": "1"}], "max_tokens": 1},
                timeout=10,
            )
            if resp.status_code == 200:
                return model
        except Exception:
            pass
        # 回退：尝试 LM Studio 中第一个能响应的模型
        try:
            r = requests.get(f"{self.lm_url}/models", timeout=5)
            if r.status_code == 200:
                for m in r.json().get("data", []):
                    mid = m.get("id", "")
                    if not mid or mid.startswith(".") or "embed" in mid.lower():
                        continue
                    test = requests.post(
                        f"{self.lm_url}/chat/completions",
                        json={"model": mid, "messages": [{"role": "user", "content": "1"}], "max_tokens": 1},
                        timeout=10,
                    )
                    if test.status_code == 200:
                        log(f"    ℹ️ 使用备用模型: {mid}")
                        return mid
        except Exception:
            pass
        return model

    # ---- AI 标题生成 ----
    def generate_title(self, content, model=None):
        if not content:
            return "无标题"
        model = self._resolve_model(model)
        try:
            resp = requests.post(
                f"{self.lm_url}/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是标题生成助手。只输出标题，不要其他内容。"},
                        {"role": "user", "content": f"请为以下内容生成一个简短的中文标题（10字以内）：\n\n{content[:500]}"}
                    ],
                    "max_tokens": 30,
                    "temperature": 0.3,
                },
                timeout=60,
            )
            if resp.status_code == 200:
                title = resp.json()["choices"][0]["message"]["content"].strip()
                title = title.replace('"', "").replace("'", "").replace("《", "").replace("》", "")
                if title and len(title) < 50:
                    return title
        except Exception as e:
            log(f"    ⚠️ LM Studio 调用失败: {e}")
        return content[:15].replace("\n", " ") + "..."

    # ---- AI 复盘摘要生成 ----
    DEFAULT_SUMMARY_PROMPT = "帮我总结今日复盘，并且给我下一步的建议。"

    def generate_summary(self, content, model=None):
        if not content or len(content) < 8:
            return ""
        model = self._resolve_model(model)
        user_prompt = (
            self.config.get("review", {}).get("summary_prompt", self.DEFAULT_SUMMARY_PROMPT)
            .strip()
        )
        try:
            resp = requests.post(
                f"{self.lm_url}/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "你是一位个人成长教练，帮助用户总结每日复盘并给出下一步行动建议。语言简洁直接，口语化，不用套话。只输出总结内容，不加标题或前缀。",
                        },
                        {
                            "role": "user",
                            "content": f"{user_prompt}\n\n复盘内容：\n{content[:1500]}",
                        },
                    ],
                    "max_tokens": 300,
                    "temperature": 0.6,
                },
                timeout=90,
            )
            if resp.status_code == 200:
                summary = resp.json()["choices"][0]["message"]["content"].strip()
                if summary and len(summary) < 600:
                    return summary
        except Exception as e:
            log(f"    ⚠️ 摘要生成失败: {e}")
        return ""

    def update_page_title(self, page_id, title, title_property="名称"):
        try:
            url = f"{NOTION_API}/pages/{page_id}"
            payload = {"properties": {title_property: {"title": [{"text": {"content": title}}]}}}
            resp = requests.patch(url, headers=self.headers, json=payload, timeout=15)
            return resp.status_code == 200
        except Exception:
            return False

    # ---- 单库同步 ----
    def sync_database(self, db_name, db_id):
        log(f"  📚 同步: {db_name}")
        pages = self.query_database_all(db_id)
        log(f"    找到 {len(pages)} 个页面")

        synced = 0
        titles_generated = 0
        summaries_generated = 0
        review_cfg = self.config.get("review", {})
        auto_title = review_cfg.get("auto_title", False)
        auto_title_model = review_cfg.get("auto_title_model", None)
        auto_summary = review_cfg.get("auto_summary", False)

        for page in pages:
            page_id = page["id"]
            current_title = self.get_page_title(page)
            content = self.get_page_content(page_id)

            if not content:
                content = current_title or "无内容"

            # 自动生成标题（仅对闪念和复盘，无标题时）
            if auto_title and not current_title.strip() and db_name in ["闪念", "复盘"]:
                new_title = self.generate_title(content, model=auto_title_model)
                title_prop = self.find_title_property(page)
                if self.update_page_title(page_id, new_title, title_prop):
                    log(f"    🏷️ 生成标题: {new_title}")
                    current_title = new_title
                    titles_generated += 1

            # 自动生成复盘摘要（仅对复盘库）
            summary = ""
            if auto_summary and db_name == "复盘":
                doc_id_check = f"notion_{page_id.replace('-', '')}"
                existing = self.collection.get(ids=[doc_id_check], include=["metadatas"])
                has_summary = (
                    existing and existing.get("metadatas")
                    and existing["metadatas"][0]
                    and existing["metadatas"][0].get("summary")
                )
                if not has_summary:
                    summary = self.generate_summary(content, model=auto_title_model)
                    if summary:
                        log(f"    📝 生成摘要: {current_title[:20]}...")
                        summaries_generated += 1
                else:
                    summary = existing["metadatas"][0]["summary"]

            # 存入向量库
            doc_id = f"notion_{page_id.replace('-', '')}"
            metadata = {
                "title": current_title or "无标题",
                "source": "notion",
                "database": db_name,
                "page_id": page_id,
                "updated_at": datetime.now().isoformat(),
                "created_at": page.get("created_time", ""),
                "notion_edited_at": page.get("last_edited_time", ""),
            }
            if summary:
                metadata["summary"] = summary
            # 提取通用属性（标签、状态、日期、AI总结等）
            for prop_name, prop_val in page.get("properties", {}).items():
                ptype = prop_val.get("type")
                if ptype == "multi_select":
                    tags = [o["name"] for o in prop_val.get("multi_select", [])]
                    if tags:
                        metadata["tags"] = ",".join(tags)
                elif ptype == "select" and prop_val.get("select"):
                    if prop_name in ("状态", "Status", "status", "类型"):
                        metadata["status"] = prop_val["select"]["name"]
                elif ptype == "status" and prop_val.get("status"):
                    metadata["status"] = prop_val["status"]["name"]
                elif ptype == "date" and prop_val.get("date"):
                    # 复盘/目标的实际日期字段（用户填写，优先于页面创建时间）
                    metadata["review_date"] = prop_val["date"].get("start", "")
                elif ptype == "rich_text" and prop_name in ("AI总结", "ai_summary", "计划反思"):
                    texts = prop_val.get("rich_text", [])
                    text = "".join(t.get("plain_text", "") for t in texts).strip()
                    if text:
                        key = "ai_summary" if prop_name in ("AI总结", "ai_summary") else "plan_reflection"
                        metadata[key] = text[:800]
            self.collection.upsert(
                ids=[doc_id],
                documents=[content],
                metadatas=[metadata],
            )
            synced += 1

        log(f"    ✅ 同步 {synced} 页, 生成 {titles_generated} 个标题, {summaries_generated} 个摘要")
        return synced

    # ---- 全量同步 ----
    def sync_all(self):
        log("🔄 开始同步...")
        databases = self.config["notion"].get("databases", {})
        total = 0
        for db_name, db_id in databases.items():
            if isinstance(db_id, dict):
                db_id = db_id.get("id", "")
            count = self.sync_database(db_name, db_id)
            total += count

        state = load_state()
        state["last_sync"] = datetime.now().isoformat()
        save_state(state)

        log(f"✅ 完成，共 {total} 个页面")
        return total

    # ---- 搜索 ----
    def search(self, query, limit=None, max_results=25, all_notes=False):
        """按语义相似度 + 标签相关性检索知识库。

        - 不再固定返回 5 条，而是按相关性「有多少相关返回多少」（上限 max_results）。
        - 用相对距离门槛过滤掉与问题无关的笔记，避免注入无关来源。
        - 命中标签/分类（database / tags / 标题词）的笔记会被放宽保留。
        - all_notes=True 时：综合全部笔记（用于「今天想思考什么」洞察），不做相关性过滤。
        """
        try:
            total = self.collection.count()
            if total == 0:
                return []
            topk = min(total, 200 if all_notes else 60)
            results = self.collection.query(query_texts=[query], n_results=topk)
            docs = (results.get("documents") or [[]])[0]
            metas = (results.get("metadatas") or [[]])[0]
            dists = (results.get("distances") or [[]])[0]

            q_lower = (query or "").lower()
            cand = []
            for i, doc in enumerate(docs):
                meta = metas[i] if i < len(metas) else {}
                dist = dists[i] if i < len(dists) else None
                tags_str = meta.get("tags", "") or ""
                db = meta.get("database", "") or ""
                title = meta.get("title", "Untitled") or "Untitled"
                # 标签/分类相关性：问题里是否提到该笔记的分类、标签或标题关键词
                tag_terms = [t.strip() for t in tags_str.split(",") if t.strip()]
                tag_hit = bool(db and db.lower() in q_lower)
                tag_hit = tag_hit or any(t.lower() in q_lower for t in tag_terms)
                tag_hit = tag_hit or any(len(w) >= 2 and w.lower() in q_lower for w in title.split())
                cand.append({
                    "title": title,
                    "content": doc[:1200],
                    "source": meta.get("source", "unknown"),
                    "database": db,
                    "tags": tags_str,
                    "page_id": meta.get("page_id", ""),
                    "_dist": dist,
                    "_tag_hit": tag_hit,
                })

            if not cand:
                return []

            if all_notes:
                # 综合全部笔记：按距离升序返回，不做相关性过滤
                cand.sort(key=lambda c: (c["_dist"] if c["_dist"] is not None else 9e9))
                cand = cand[:(limit or 200)]
                for c in cand:
                    c.pop("_dist", None)
                    c.pop("_tag_hit", None)
                return cand

            valid = [c for c in cand if c["_dist"] is not None]
            if valid:
                best = min(c["_dist"] for c in valid)
                # 相对距离门槛：与最相关结果接近的才算相关；命中标签的放宽
                kept = []
                for c in cand:
                    d = c["_dist"]
                    if d is None:
                        continue
                    rel_ok = d <= best * 1.6 if best > 0 else True
                    if rel_ok or c["_tag_hit"]:
                        kept.append(c)
                # 命中标签的排前面，其余按距离升序
                kept.sort(key=lambda c: (not c["_tag_hit"], c["_dist"] if c["_dist"] is not None else 9e9))
                cand = kept if kept else cand[:3]
            cap = limit or max_results
            cand = cand[:cap]
            for c in cand:
                c.pop("_dist", None)
                c.pop("_tag_hit", None)
            return cand
        except Exception as e:
            log(f"❌ 搜索失败: {e}")
            return []

    # ---- 向量库统计 ----
    def stats(self):
        try:
            return {
                "documents": self.collection.count(),
                "collections": [c.name for c in self.chroma.list_collections()],
            }
        except Exception:
            return {"documents": 0, "collections": []}


# ============ LM Studio 模型列表 ============
def get_lm_models(config):
    global _lm_models_cache
    lm_cfg = config.get("lm_studio", {})
    url = lm_cfg.get("url", "http://localhost:1234/v1")
    try:
        # 尝试 OpenAI-compatible /models 端点
        resp = requests.get(f"{url}/models", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            models = []
            for m in data.get("data", []):
                mid = m.get("id", "")
                if mid and not mid.startswith("."):
                    models.append(mid)
            if models:
                _lm_models_cache = models
                return models
    except Exception:
        pass
    # 回退：尝试 /v1/models
    try:
        resp = requests.get(f"{url}/v1/models", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            models = [m["id"] for m in data.get("data", []) if not m["id"].startswith(".")]
            if models:
                _lm_models_cache = models
                return models
    except Exception:
        pass
    return _lm_models_cache or [lm_cfg.get("default_model", "qwen2.5:14b-instruct")]


# ============ 后台同步循环 ============
def sync_loop(interval):
    global _last_sync_result
    while _service_running:
        with _sync_lock:
            try:
                config = load_config()
                if config:
                    syncer = NotionSync(config)
                    count = syncer.sync_all()
                    _last_sync_result = {"time": datetime.now().isoformat(), "count": count, "error": None}
                else:
                    _last_sync_result = {"time": datetime.now().isoformat(), "count": 0, "error": "配置不存在"}
            except Exception as e:
                _last_sync_result = {"time": datetime.now().isoformat(), "count": 0, "error": str(e)}
                log(f"❌ 同步异常: {e}")
        for _ in range(interval):
            if not _service_running:
                break
            time.sleep(1)


def start_sync_thread(interval=3600):
    global _sync_thread, _service_running
    if _sync_thread and _sync_thread.is_alive():
        return
    _service_running = True
    _sync_thread = threading.Thread(target=sync_loop, args=(interval,), daemon=True)
    _sync_thread.start()
    log(f"🚀 后台同步线程启动（间隔 {interval} 秒）")


def stop_sync_thread():
    global _service_running
    _service_running = False




# ============ Web 路由 ============
@app.route("/")
def index():
    from flask import redirect
    return redirect("http://localhost:3000", code=302)


@app.route("/api/status")
def api_status():
    state = load_state()
    config = load_config()
    count = 0
    collections = []
    last_error = None
    try:
        syncer = NotionSync(config) if config else None
        if syncer:
            st = syncer.stats()
            count = st.get("documents", 0)
            collections = st.get("collections", [])
    except Exception as e:
        last_error = str(e)

    local_path = (config.get("local_notes", {}) or {}).get("path", "") if config else ""
    notion_token_set = bool((config.get("notion", {}) or {}).get("token")) if config else False
    result = {
        "service_running": _service_running,
        "last_sync": state.get("last_sync"),
        "last_count": _last_sync_result.get("count") if _last_sync_result else None,
        "last_error": _last_sync_result.get("error") if _last_sync_result else None,
        "documents": count,
        "collections": collections,
        "databases": list(config["notion"]["databases"].keys()) if config else [],
        "local_notes_path": local_path,
        "local_notes_connected": bool(local_path and os.path.isdir(local_path)),
        "notion_token_set": notion_token_set,
    }
    return jsonify(result)


@app.route("/api/sync", methods=["POST"])
def api_sync():
    global _last_sync_result
    if not _sync_lock.acquire(blocking=False):
        return jsonify({"error": "同步正在进行中，请稍后再试"}), 409
    try:
        config = load_config()
        if not config:
            return jsonify({"error": "配置不存在"}), 500
        syncer = NotionSync(config)
        count = syncer.sync_all()
        _last_sync_result = {"time": datetime.now().isoformat(), "count": count, "error": None}
        return jsonify({"success": True, "synced": count})
    except Exception as e:
        _last_sync_result = {"time": datetime.now().isoformat(), "count": 0, "error": str(e)}
        return jsonify({"error": str(e)}), 500
    finally:
        _sync_lock.release()


@app.route("/api/reindex", methods=["POST"])
def api_reindex():
    """重建向量索引：清空增量同步状态后做一次全量同步，强制重新读取并嵌入所有笔记。

    用途：当 AI 检索结果异常、向量库与笔记不一致或嵌入损坏时，用它从头重建索引。
    不会删除 Notion / 本地的原始数据。
    """
    global _last_sync_result
    if not _sync_lock.acquire(blocking=False):
        return jsonify({"error": "同步/重建正在进行中，请稍后再试"}), 409
    try:
        config = load_config()
        if not config:
            return jsonify({"error": "配置不存在"}), 500
        # 清空增量映射，强制全量重嵌入
        state = load_state()
        state["note_mapping"] = {}
        save_state(state)
        syncer = NotionSync(config)
        count = syncer.sync_all()
        _last_sync_result = {"time": datetime.now().isoformat(), "count": count, "error": None}
        return jsonify({"success": True, "reindexed": count})
    except Exception as e:
        _last_sync_result = {"time": datetime.now().isoformat(), "count": 0, "error": str(e)}
        return jsonify({"error": str(e)}), 500
    finally:
        _sync_lock.release()


@app.route("/api/index_local_reviews", methods=["POST"])
def api_index_local_reviews():
    """将本地 reviews.json 全量写入 ChromaDB（从 Flask 进程内执行）。"""
    try:
        reviews = _load_json(REVIEWS_FILE, [])
        for r in reviews:
            _chroma_index_review(r)
        return jsonify({"ok": True, "indexed": len(reviews)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/regenerate_summaries", methods=["POST"])
def api_regenerate_summaries():
    """清空复盘的 summary/aiInsights，用新提示词重新生成。
    body: { "scope": "year" | "all" }  默认 "all"
    """
    config = load_config()
    if not config:
        return jsonify({"ok": False, "error": "配置不存在"}), 500
    body = request.get_json() or {}
    scope = body.get("scope", "all")  # "year" or "all"

    # 计算截止日期（年范围）
    from datetime import date as _date
    cutoff = None
    if scope == "year":
        cutoff = (_date.today().replace(year=_date.today().year - 1)).isoformat()

    syncer = NotionSync(config)
    coll = syncer.collection

    # ── Notion 复盘：清空旧 summary，重新生成
    data = coll.get(limit=500, include=["documents", "metadatas"])
    notion_count = 0
    for i, doc in enumerate(data.get("documents", []) or []):
        meta = ((data.get("metadatas") or [{}])[i]) or {}
        if meta.get("database") != "复盘" or meta.get("source") != "notion":
            continue
        # scope 过滤
        if cutoff:
            entry_date = (meta.get("review_date") or meta.get("created_at") or "")[:10]
            if entry_date and entry_date < cutoff:
                continue
        doc_id = (data.get("ids") or [])[i]
        meta.pop("summary", None)
        # 若正文太短，拼接 ai_summary / plan_reflection 作为上下文
        content_for_gen = doc
        if len(doc) < 30:
            extras = [meta.get("ai_summary", ""), meta.get("plan_reflection", "")]
            content_for_gen = "\n".join([doc] + [e for e in extras if e]).strip()
        new_summary = syncer.generate_summary(content_for_gen)
        if new_summary:
            meta["summary"] = new_summary
        coll.upsert(ids=[doc_id], documents=[doc], metadatas=[meta])
        notion_count += 1
        log(f"  ✅ 重新总结: {meta.get('title', '')[:20]}")

    # ── 本地复盘：重新生成 aiInsights
    reviews = _load_json(REVIEWS_FILE, [])
    local_count = 0
    for r in reviews:
        # scope 过滤
        if cutoff and (r.get("date", "") or "") < cutoff:
            continue
        content = r.get("content", "")
        if not content or len(content) < 8:
            continue
        new_summary = syncer.generate_summary(content)
        if new_summary:
            r["aiInsights"] = new_summary
            local_count += 1
            log(f"  ✅ 本地复盘重新总结: {r.get('title', '')[:20]}")

    if local_count > 0:
        _save_json(REVIEWS_FILE, reviews)
        for r in reviews:
            _chroma_index_review(r)

    return jsonify({"ok": True, "notion": notion_count, "local": local_count})


@app.route("/api/search", methods=["POST"])
def api_search():
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 500
    data = request.json or {}
    query = data.get("query", "")
    limit = data.get("limit", 5)
    if not query:
        return jsonify({"results": []})
    syncer = NotionSync(config)
    return jsonify({"results": syncer.search(query, limit)})


@app.route("/api/models")
def api_models():
    config = load_config() or {}
    models = get_lm_models(config)
    active = config.get("active_model") or {}
    lm_cfg = config.get("lm_studio", {})
    current = active.get("model") or lm_cfg.get("default_model", "")
    provider = active.get("provider") or "local"
    return jsonify({"models": models, "current": current, "provider": provider})


@app.route("/api/online_models")
def api_online_models():
    """获取线上 API 可用模型列表"""
    config = load_config()
    online = (config or {}).get("online", {})
    url = online.get("url", "").rstrip("/")
    api_key = online.get("api_key", "")
    if not url:
        return jsonify({"models": []})
    try:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        resp = requests.get(f"{url}/models", headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        models = [m["id"] for m in data.get("data", [])]
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"models": [], "error": str(e)})


def _notion_headers():
    config = load_config() or {}
    token = config.get("notion", {}).get("token", "")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
    }


def _blocks_to_text(blocks):
    lines = []
    for block in blocks:
        bt = block.get("type", "")
        if bt in ("paragraph", "heading_1", "heading_2", "heading_3",
                  "bulleted_list_item", "numbered_list_item", "to_do", "quote"):
            rich = block.get(bt, {}).get("rich_text", [])
            text = "".join(t.get("plain_text", "") for t in rich)
            if text:
                lines.append(text)
    return "\n".join(lines)


@app.route("/api/note/<page_id>")
def api_get_note(page_id):
    """从 Notion 获取页面完整内容"""
    headers = _notion_headers()
    try:
        # 获取页面属性
        page_resp = requests.get(f"{NOTION_API}/pages/{page_id}", headers=headers, timeout=15)
        page_resp.raise_for_status()
        page = page_resp.json()

        # 提取标题
        title = ""
        for val in page.get("properties", {}).values():
            if val.get("type") == "title":
                arr = val.get("title", [])
                if arr:
                    title = arr[0].get("plain_text", "")
                break

        # 获取 blocks 内容
        blocks_resp = requests.get(f"{NOTION_API}/blocks/{page_id}/children", headers=headers, timeout=15)
        blocks_resp.raise_for_status()
        blocks = blocks_resp.json().get("results", [])
        content = _blocks_to_text(blocks)

        return jsonify({
            "title": title,
            "content": content,
            "created": page.get("created_time", ""),
            "updated": page.get("last_edited_time", ""),
            "url": page.get("url", ""),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/note/<page_id>", methods=["PATCH"])
def api_update_note(page_id):
    """更新笔记：先更新本地 ChromaDB，再异步同步到 Notion"""
    data = request.json or {}
    title = data.get("title")
    content = data.get("content")
    tags = data.get("tags")
    status = data.get("status")
    doc_id = f"notion_{page_id.replace('-', '')}"

    # 1. 立即更新 ChromaDB metadata（本地快速操作，不等 Notion）
    try:
        _coll = get_knowledge_collection()
        existing = _coll.get(ids=[doc_id], include=["metadatas"])
        if existing["ids"]:
            meta = dict(existing["metadatas"][0])
            if title is not None: meta["title"] = title
            if tags is not None: meta["tags"] = tags
            if status is not None: meta["status"] = status
            _coll.update(ids=[doc_id], metadatas=[meta])
    except Exception as ce:
        print(f"[WARN] ChromaDB meta update ({page_id}): {ce}")

    # 2. 在后台线程异步同步到 Notion
    def _sync_notion():
        try:
            hdrs = _notion_headers()
            if title is not None or tags is not None or status is not None:
                page_resp = requests.get(f"{NOTION_API}/pages/{page_id}", headers=hdrs, timeout=10)
                page_resp.raise_for_status()
                props = page_resp.json().get("properties", {})
                patch_props = {}
                if title is not None:
                    title_prop = next((k for k, v in props.items() if v.get("type") == "title"), "名称")
                    patch_props[title_prop] = {"title": [{"text": {"content": title}}]}
                if tags is not None:
                    tags_list = [t.strip() for t in tags.split(",") if t.strip()]
                    ms_key = next((k for k, v in props.items() if v.get("type") == "multi_select"), None)
                    if ms_key:
                        patch_props[ms_key] = {"multi_select": [{"name": t} for t in tags_list]}
                if status is not None:
                    st_key = next((k for k, v in props.items() if v.get("type") == "status"), None)
                    if st_key:
                        patch_props[st_key] = {"status": {"name": status}}
                if patch_props:
                    requests.patch(f"{NOTION_API}/pages/{page_id}", headers=hdrs,
                                   json={"properties": patch_props}, timeout=15).raise_for_status()
            if content is not None:
                blocks_resp = requests.get(f"{NOTION_API}/blocks/{page_id}/children", headers=hdrs, timeout=15)
                blocks_resp.raise_for_status()
                deletable = {"paragraph", "bulleted_list_item", "numbered_list_item", "quote", "to_do"}
                for block in blocks_resp.json().get("results", []):
                    if block.get("type") in deletable:
                        requests.delete(f"{NOTION_API}/blocks/{block['id']}", headers=hdrs, timeout=10)
                paragraphs = [p for p in content.split("\n") if p.strip()] or [content]
                new_blocks = [{"object": "block", "type": "paragraph",
                               "paragraph": {"rich_text": [{"type": "text", "text": {"content": p[:2000]}}]}}
                              for p in paragraphs]
                requests.patch(f"{NOTION_API}/blocks/{page_id}/children", headers=hdrs,
                               json={"children": new_blocks}, timeout=15).raise_for_status()
                # 同步完成后更新 ChromaDB 文档向量
                try:
                    _c = get_knowledge_collection()
                    ex2 = _c.get(ids=[doc_id], include=["metadatas"])
                    if ex2["ids"]:
                        _c.update(ids=[doc_id], documents=[content], metadatas=[dict(ex2["metadatas"][0])])
                except Exception: pass
        except Exception as e:
            print(f"[ERROR] Notion sync note {page_id}: {e}")

    threading.Thread(target=_sync_notion, daemon=True).start()
    return jsonify({"ok": True})


@app.route("/api/note/<page_id>", methods=["DELETE"])
def api_delete_note(page_id):
    """删除笔记：先从 ChromaDB 移除，再异步归档 Notion"""
    try:
        # 1. 立即从 ChromaDB 删除（本地快速操作）
        db_client = get_chroma()
        target_title = None
        for coll in db_client.list_collections():
            try:
                res = coll.get(where={"page_id": page_id}, include=["metadatas"])
                metas = res.get("metadatas") or []
                if metas and metas[0]:
                    target_title = metas[0].get("title")
                    break
            except Exception:
                pass
        for coll in db_client.list_collections():
            try: coll.delete(where={"page_id": page_id})
            except Exception: pass
            if target_title:
                try: coll.delete(where={"title": target_title})
                except Exception: pass

        # 2. 后台异步归档 Notion 页面
        def _archive():
            try:
                requests.patch(f"{NOTION_API}/pages/{page_id}", headers=_notion_headers(),
                               json={"archived": True}, timeout=15).raise_for_status()
            except Exception as e:
                print(f"[WARN] Notion 归档失败 ({page_id}): {e}")

        threading.Thread(target=_archive, daemon=True).start()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/model", methods=["POST"])
def api_set_model():
    data = request.json or {}
    model = data.get("model", "").strip()
    provider = (data.get("provider") or "").strip()
    if not model:
        return jsonify({"error": "模型名为空"}), 400
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 500
    # provider 未显式给出时，根据线上模型列表/默认模型推断
    if provider not in ("local", "online"):
        online = config.get("online", {}) or {}
        provider = "online" if model == online.get("default_model") else "local"
    # 记录当前激活的模型与来源（对话据此路由到本地或线上）
    config["active_model"] = {"provider": provider, "model": model}
    if provider == "online":
        config.setdefault("online", {})["default_model"] = model
    else:
        config.setdefault("lm_studio", {})["default_model"] = model
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)
    global _lm_models_cache
    _lm_models_cache = []
    return jsonify({"ok": True, "model": model, "provider": provider})


@app.route("/api/logs")
def api_logs():
    log_file = LOG_DIR / "sync.log"
    lines = []
    if log_file.exists():
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                all_lines = f.readlines()
            lines = [l.rstrip() for l in all_lines[-50:]]
        except Exception:
            pass
    return jsonify({"lines": lines})


@app.route("/api/notion_reviews")
def api_notion_reviews():
    """返回 Notion 复盘库中的页面（含 AI 摘要），按 updated_at 排序"""
    try:
        client = get_chroma()
        results = []
        for coll in client.list_collections():
            try:
                data = coll.get(limit=500, include=["documents", "metadatas"])
                for i, doc in enumerate(data.get("documents", []) or []):
                    meta = (data.get("metadatas") or [{}])[i] or {}
                    if meta.get("database") != "复盘":
                        continue
                    if meta.get("source") == "local_review":
                        continue
                    results.append({
                        "id": meta.get("page_id", f"notion_review_{i}"),
                        "title": meta.get("title", "无标题"),
                        "content": doc[:300],
                        "summary": meta.get("summary", ""),
                        "date": (meta.get("created_at") or meta.get("updated_at") or "")[:10],
                        "updated_at": meta.get("updated_at", ""),
                    })
            except Exception:
                pass
        # 按 page_id 去重，保留最新的
        seen = {}
        for r in results:
            pid = r["id"]
            if pid not in seen or r.get("updated_at", "") > seen[pid].get("updated_at", ""):
                seen[pid] = r
        unique = sorted(seen.values(), key=lambda x: x.get("updated_at", ""), reverse=True)
        return jsonify({"reviews": unique[:50]})
    except Exception as e:
        return jsonify({"reviews": [], "error": str(e)}), 500


@app.route("/api/notes")
def api_notes():
    """返回所有已索引的笔记（从 ChromaDB），用于搜索页实时展示"""
    try:
        client = get_chroma()
        results = []
        for coll in client.list_collections():
            try:
                data = coll.get(limit=2000, include=["documents", "metadatas"])
                for i, doc in enumerate(data.get("documents", []) or []):
                    meta = (data.get("metadatas") or [{}])[i] or {}
                    results.append({
                        "id": meta.get("page_id", f"chunk_{i}"),
                        "title": meta.get("title", "无标题"),
                        "content": doc[:200],
                        "database": meta.get("database", ""),
                        "updated": meta.get("notion_edited_at", "") or meta.get("updated_at", ""),
                        "created": meta.get("created_at", ""),
                        "tags": meta.get("tags", ""),
                        "status": meta.get("status", ""),
                    })
            except Exception:
                pass
        # 去重按 title
        seen = set()
        unique = []
        for r in results:
            if r["title"] not in seen and r["title"] != "无标题":
                seen.add(r["title"])
                unique.append(r)
        return jsonify({"notes": unique})
    except Exception as e:
        return jsonify({"notes": [], "error": str(e)}), 500


@app.route("/api/notes", methods=["POST"])
def api_create_note():
    """在 Notion 中创建新页面，并同步到 ChromaDB"""
    try:
        data = request.json or {}
        title = (data.get("title") or "无标题").strip() or "无标题"
        db_name = data.get("database", "闪念")

        config = load_config()
        if not config:
            return jsonify({"error": "配置未找到"}), 500

        token = config.get("notion", {}).get("token", "")
        databases = config.get("notion", {}).get("databases", {})
        db_info = databases.get(db_name, {})
        db_id = db_info.get("id", "") if isinstance(db_info, dict) else db_info
        if not db_id:
            return jsonify({"error": f"数据库 {db_name} 未找到"}), 400

        headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}

        # 获取数据库 schema 确定 title 属性名及状态属性
        schema_resp = requests.get(f"{NOTION_API}/databases/{db_id}", headers=headers, timeout=10)
        schema_resp.raise_for_status()
        title_prop = "名称"
        status_prop = None
        status_prop_type = None
        for prop_name, prop_val in schema_resp.json().get("properties", {}).items():
            if prop_val.get("type") == "title":
                title_prop = prop_name
            if prop_val.get("type") in ("status", "select") and prop_name in ("状态", "Status", "status"):
                status_prop = prop_name
                status_prop_type = prop_val.get("type")

        # 在 Notion 创建页面（目标库自动设"未开始"状态）
        page_properties = {title_prop: {"title": [{"text": {"content": title}}]}}
        if db_name == "目标" and status_prop and status_prop_type:
            if status_prop_type == "status":
                page_properties[status_prop] = {"status": {"name": "未开始"}}
            else:
                page_properties[status_prop] = {"select": {"name": "未开始"}}
        page_resp = requests.post(
            f"{NOTION_API}/pages",
            headers=headers,
            json={"parent": {"database_id": db_id}, "properties": page_properties},
            timeout=15,
        )
        page_resp.raise_for_status()
        page = page_resp.json()
        page_id = page["id"]
        created_at = page.get("created_time", "")
        now_iso = datetime.now().isoformat()

        # 同步到 ChromaDB
        chroma_client = get_chroma()
        try:
            coll = chroma_client.get_collection("knowledge")
        except Exception:
            coll = chroma_client.create_collection("knowledge")
        doc_id = f"notion_{page_id.replace('-', '')}"
        initial_status = "未开始" if db_name == "目标" else ""
        coll.upsert(
            ids=[doc_id],
            documents=[title],
            metadatas=[{"title": title, "source": "notion", "database": db_name, "page_id": page_id,
                        "updated_at": now_iso, "created_at": created_at, "tags": "", "status": initial_status}],
        )

        return jsonify({"note": {
            "id": page_id, "title": title, "content": "",
            "database": db_name, "updated": now_iso,
            "created": created_at, "tags": "", "status": initial_status,
        }})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/settings")
def api_settings():
    """返回配置（敏感字段已脱敏），不含 token 明文"""
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 404
    notion = config.get("notion", {})
    lm = config.get("lm_studio", {})
    online = config.get("online", {})
    sync_cfg = config.get("sync", {})
    review_cfg = config.get("review", {})
    return jsonify({
        "notion": {
            "token": "****" + (notion.get("token", "")[-8:] if notion.get("token") else ""),
            "databases": notion.get("databases", {}),
        },
        "lm_studio": {
            "url": lm.get("url", "http://localhost:1234/v1"),
            "default_model": lm.get("default_model", ""),
        },
        "online": {
            "url": online.get("url", ""),
            "api_key": ("****" + online.get("api_key", "")[-4:]) if online.get("api_key") else "",
            "default_model": online.get("default_model", ""),
        },
        "sync": {
            "interval": sync_cfg.get("interval", 21600),
            "auto": sync_cfg.get("auto", False),
            "auto_title": sync_cfg.get("auto_title", True),
        },
        "review": {
            "summary_prompt": review_cfg.get("summary_prompt", "帮我总结今日复盘，并且给我下一步的建议。"),
            "auto_show_summary": review_cfg.get("auto_show_summary", True),
        },
        "local_notes": {
            "path": config.get("local_notes", {}).get("path", ""),
        },
        "web": config.get("web", {}),
    })


@app.route("/api/settings/secret")
def api_settings_secret():
    """返回敏感字段明文（仅本地使用，用于编辑时回显）。"""
    config = load_config() or {}
    return jsonify({
        "notion_token": config.get("notion", {}).get("token", ""),
        "local_notes_path": config.get("local_notes", {}).get("path", ""),
    })


@app.route("/api/settings", methods=["POST"])
def api_settings_update():
    """更新配置并写回 notion.yaml"""
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 404
    data = request.json or {}

    # 更新 notion databases
    if "notion_databases" in data:
        if "notion" not in config:
            config["notion"] = {}
        config["notion"]["databases"] = data["notion_databases"]

    # 更新 Notion 集成密钥（忽略打码占位，避免覆盖真实 token）
    if data.get("notion_token") and "****" not in data["notion_token"]:
        config.setdefault("notion", {})["token"] = data["notion_token"].strip()

    # 更新本地笔记路径
    if "local_notes" in data:
        config["local_notes"] = {**config.get("local_notes", {}), **data["local_notes"]}

    # 更新 lm_studio
    if "lm_studio" in data:
        config["lm_studio"] = {**config.get("lm_studio", {}), **data["lm_studio"]}

    # 更新线上 API
    if "online" in data:
        config["online"] = {**config.get("online", {}), **data["online"]}

    # 更新 sync
    if "sync" in data:
        config["sync"] = {**config.get("sync", {}), **data["sync"]}

    # 更新复盘设置
    if "review" in data:
        config["review"] = {**config.get("review", {}), **data["review"]}

    # 写回文件
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _resolve_llm(config, model=None, provider=None):
    """根据 provider/model 解析实际调用目标。

    返回 (base_url, api_key, model_name, provider)。
    - provider 缺省时读取 active_model.provider，再退回 'local'。
    - 'online' 走 config.online（OpenAI 兼容，带 api_key）；否则走本地 LM Studio。
    """
    active = config.get("active_model") or {}
    if not provider:
        provider = active.get("provider") or "local"
    online = config.get("online", {}) or {}
    lm = config.get("lm_studio", {}) or {}
    if provider == "online":
        base = (online.get("url") or "https://api.openai.com/v1").rstrip("/")
        key = online.get("api_key") or ""
        model = model or active.get("model") or online.get("default_model") or ""
        return base, key, model, "online"
    base = (lm.get("url") or "http://localhost:1234/v1").rstrip("/")
    model = model or active.get("model") or lm.get("default_model") or ""
    return base, "", model, "local"


# 聊天模板里的「轮次/结束」控制符——必须作为停止词，否则模型会把它当正文吐出，
# 之后常跟随退化的乱码循环（如一连串单字母）。
STOP_SEQS = ["<turn|>", "<|im_end|>", "<|eot_id|>", "<end_of_turn>"]
_CTRL_TRUNCATE_RE = re.compile(r"<turn\|?>|<\|im_end\|>|<\|endoftext\|>|<end_of_turn>|<\|eot_id\|>|<\|im_start\|>")
# 退化重复：连续 12+ 个以空白/逗号分隔的单字母（模型崩坏的特征）
_DEGEN_RE = re.compile(r"(?:\b[a-zA-Z]\b[\s,，]+){12,}")


def _truncate_artifacts(text):
    """在控制符或退化乱码处截断模型输出。"""
    if not text:
        return text
    m = _CTRL_TRUNCATE_RE.search(text)
    if m:
        text = text[:m.start()]
    m = _DEGEN_RE.search(text)
    if m:
        text = text[:m.start()]
    return text


def _strip_think(text):
    """去除推理型模型（如 MiniMax M2、DeepSeek-R1）输出的 <think> 思考块与残留标记/控制符。"""
    if not text:
        return text
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S | re.I)
    # 只剩闭合标签（开头思考被吞）：丢弃到 </think> 为止
    if "</think>" in text and "<think>" not in text:
        text = text.split("</think>", 1)[1]
    text = re.sub(r"</?think>", "", text, flags=re.I)
    text = _truncate_artifacts(text)
    # 清掉残留的 <|...|> 控制符
    text = re.sub(r"<\|[^>]*\|>", "", text)
    return text.strip()


def _assemble_chat(config, data):
    """构造对话 prompt（RAG + @ 引用）。

    返回 (base_url, api_key, model, system_prompt, user_prompt, results)。
    """
    query = data.get("query", "")
    base_url, api_key, model, provider = _resolve_llm(config, data.get("model"), data.get("provider"))
    sources = data.get("sources")  # optional list of source IDs to filter
    no_rag = data.get("no_rag", False)  # skip knowledge base search entirely
    all_notes = data.get("all_notes", False)  # 综合全部笔记（洞察模块）
    ref_note_ids = data.get("ref_note_ids") or []  # 用户 @ 显式引用的笔记 page_id 列表

    # 0. 显式引用的笔记（@ 引用）：按 page_id 从 ChromaDB 取完整正文，保证注入
    ref_results = []
    if ref_note_ids and isinstance(ref_note_ids, list):
        try:
            _client = get_chroma()
            _colls = _client.list_collections()
            for pid in ref_note_ids:
                if any(r["page_id"] == pid for r in ref_results):
                    continue  # 每条引用笔记只取一次
                for coll in _colls:
                    try:
                        got = coll.get(where={"page_id": pid}, include=["documents", "metadatas"])
                    except Exception:
                        continue
                    docs = got.get("documents") or []
                    metas = got.get("metadatas") or []
                    if not docs:
                        continue
                    full = "\n".join(d for d in docs if d)
                    meta = metas[0] if metas else {}
                    ref_results.append({
                        "title": meta.get("title", "引用笔记"),
                        "content": full,
                        "source": meta.get("source", ""),
                        "database": meta.get("database", ""),
                        "page_id": pid,
                    })
                    break  # 已在某个 collection 找到，不再查其他
        except Exception as re:
            print(f"[WARN] ref_note_ids 取正文失败: {re}")

    # 1. 搜索知识库（no_rag=True 时跳过）——按相似度/标签返回相关的全部笔记（上限 25），而非固定 5 条
    results = []
    if not no_rag:
        syncer = NotionSync(config)
        results = syncer.search(query, all_notes=all_notes)

        # Filter by requested sources if provided
        if sources and isinstance(sources, list):
            filtered = []
            for r in results:
                src = r.get("source", "")
                db = r.get("database", "")
                if "notion" in sources and ("notion.so" in src or db):
                    filtered.append(r)
                elif "local" in sources and src and "notion.so" not in src:
                    filtered.append(r)
                elif any(s in src or s in db for s in sources if s not in ("notion", "local")):
                    filtered.append(r)
            if filtered:
                results = filtered

    # 1.5 引用笔记排在 RAG 结果前面，并去重（按 page_id）后合并
    seen_pids = {r.get("page_id") for r in ref_results if r.get("page_id")}
    merged = ref_results + [r for r in results if r.get("page_id") not in seen_pids]

    # 2. 构造 prompt（引用笔记在前，保证被看到）
    context = "\n\n".join(
        f"[{r.get('title', '未知来源')}]({r.get('source', '')}):\n{r.get('content', '')}"
        for r in merged
    )
    # 返回给前端的来源列表（含显式引用）
    results = merged
    if no_rag and not context:
        system_prompt = (
            "你是一位简洁、务实的中文助手。"
            "直接完成用户的请求，不要做任何铺垫或解释，不要评论信息来源。"
            "回答简短，直击要点。"
        )
        user_prompt = query
    else:
        system_prompt = (
            "你是一个智能助手，基于用户的知识库回答问题。\n"
            "知识库内容是按相关性检索来的，但其中可能仍有与本次问题无关的条目。\n"
            "请只采用与用户问题真正相关的内容来回答；与问题无关的条目请直接忽略，不要强行使用，也不要提及它们。\n"
            "如果知识库中没有相关信息，请直接给出你的建议，不要说明知识库里有什么或没什么。\n"
            "回答要简洁、有条理，用中文回答。\n"
        )
        user_prompt = f"知识库内容:\n{context}\n\n用户请求: {query}" if context else query

    return base_url, api_key, model, system_prompt, user_prompt, results, provider


@app.route("/api/chat", methods=["POST"])
def api_chat():
    """AI 对话（非流式）：先搜知识库，再调 LM Studio 生成回答"""
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 500
    data = request.json or {}
    if not data.get("query"):
        return jsonify({"error": "query is required"}), 400

    base_url, api_key, model, system_prompt, user_prompt, results, provider = _assemble_chat(config, data)
    svc = "线上 API" if provider == "online" else "本地 LM Studio"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.7,
                "max_tokens": 2048,
                "stop": STOP_SEQS,
            },
            timeout=120,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
        msg = resp.json()["choices"][0]["message"]
        answer = _strip_think(msg.get("content") or "")
        if not answer:
            # 推理模型可能只返回了 reasoning_content（max_tokens 被思考耗尽）
            answer = _strip_think(msg.get("reasoning_content") or "")
        if not answer:
            answer = f"模型未返回正文内容（{svc} · {model}）。可能是 max_tokens 被推理过程耗尽或返回格式不兼容。"
    except Exception as e:
        answer = f"模型调用失败: {e}。请确认 {svc}（{base_url}）可访问、API Key 与模型名「{model}」正确。"
        results = []

    return jsonify({"answer": answer, "sources": results, "model": model})


@app.route("/api/chat/stream", methods=["POST"])
def api_chat_stream():
    """AI 对话（流式 SSE）：先发 sources，再逐 token 推送 delta，最后 done。"""
    import json as _sse
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 500
    data = request.json or {}
    if not data.get("query"):
        return jsonify({"error": "query is required"}), 400

    base_url, api_key, model, system_prompt, user_prompt, results, provider = _assemble_chat(config, data)
    svc = "线上 API" if provider == "online" else "本地 LM Studio"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    def generate():
        yield f"data: {_sse.dumps({'type': 'sources', 'sources': results})}\n\n"
        # 流式过滤推理块：丢弃 <think>...</think> 之间的内容
        in_think = False
        pending = ""  # 缓冲可能跨 chunk 的标签
        def feed(text):
            nonlocal in_think, pending
            out = []
            pending_local = pending + text
            pending = ""
            while pending_local:
                if in_think:
                    idx = pending_local.lower().find("</think>")
                    if idx == -1:
                        # 末尾可能是不完整的 </think>，保留以便下次拼接
                        if pending_local[-8:].lower() in "</think>"[:len(pending_local[-8:])]:
                            pending = pending_local[-8:]
                        pending_local = ""
                        break
                    in_think = False
                    pending_local = pending_local[idx + 8:]
                else:
                    idx = pending_local.lower().find("<think>")
                    if idx == -1:
                        tail = pending_local[-7:]
                        if "<think>".startswith(tail.lower()) and tail:
                            pending = tail
                            out.append(pending_local[:-7])
                        else:
                            out.append(pending_local)
                        pending_local = ""
                        break
                    out.append(pending_local[:idx])
                    in_think = True
                    pending_local = pending_local[idx + 7:]
            return "".join(out)
        content_count = 0   # 收到的正文片段数
        reasoning_seen = False  # 是否只收到了推理内容
        emit_buf = ""       # 已收到的可见正文（用于在控制符/乱码处截断）
        emitted = 0         # 已下发的字符数
        stopped = False     # 命中控制符/退化乱码后停止下发
        try:
            with requests.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2048,
                    "stream": True,
                    "stop": STOP_SEQS,
                },
                stream=True, timeout=120,
            ) as r:
                if r.status_code >= 400:
                    body = r.text[:300]
                    yield f"data: {_sse.dumps({'type': 'error', 'text': f'{svc} 返回 HTTP {r.status_code}：{body}'})}\n\n"
                    yield f"data: {_sse.dumps({'type': 'done', 'model': model})}\n\n"
                    return
                for raw in r.iter_lines():
                    if not raw:
                        continue
                    line = raw.decode("utf-8", "ignore")
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        delta_obj = _sse.loads(payload)["choices"][0].get("delta") or {}
                    except Exception:
                        continue
                    delta = delta_obj.get("content")
                    if not delta:
                        # 推理模型可能把思考放在 reasoning_content 字段
                        if delta_obj.get("reasoning_content"):
                            reasoning_seen = True
                        continue
                    visible = feed(delta)
                    if visible and not stopped:
                        emit_buf += visible
                        clean = _truncate_artifacts(emit_buf)
                        add = clean[emitted:]
                        if len(clean) < len(emit_buf):
                            stopped = True  # 命中控制符/乱码：只发干净部分，停止后续
                        if add:
                            content_count += 1
                            emitted += len(add)
                            yield f"data: {_sse.dumps({'type': 'delta', 'text': add})}\n\n"
                        if stopped:
                            break
            if content_count == 0:
                if reasoning_seen:
                    hint = f"模型只输出了推理内容、没有正文（{svc} · {model}）。请把 max_tokens 调大或换用非推理模型。"
                else:
                    hint = f"模型未返回正文内容（{svc} · {model}）。请确认模型名与服务返回格式兼容。"
                yield f"data: {_sse.dumps({'type': 'error', 'text': hint})}\n\n"
        except Exception as e:
            yield f"data: {_sse.dumps({'type': 'error', 'text': f'模型调用失败: {e}。请确认 {svc}（{base_url}）可访问、API Key 与模型名「{model}」正确。'})}\n\n"
        yield f"data: {_sse.dumps({'type': 'done', 'model': model})}\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ============ TODO & Reviews API ============
import json as _json
import uuid as _uuid
from datetime import datetime, timezone

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
TODOS_FILE = DATA_DIR / "todos.json"
REVIEWS_FILE = DATA_DIR / "reviews.json"

def _load_json(path, default):
    try:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return _json.load(f)
    except Exception:
        pass
    return default

def _save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        _json.dump(data, f, ensure_ascii=False, indent=2)

@app.route("/api/todos", methods=["GET"])
def api_todos():
    todos = _load_json(TODOS_FILE, [])
    return jsonify({"todos": todos})

@app.route("/api/todos", methods=["POST"])
def api_create_todo():
    data = request.get_json() or {}
    todo = {
        "id": str(_uuid.uuid4()),
        "title": data.get("title", ""),
        "tag": data.get("tag", "work"),
        "priority": data.get("priority", "medium"),
        "estimatedMinutes": data.get("estimatedMinutes", 60),
        "completedAt": None,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    todos = _load_json(TODOS_FILE, [])
    todos.insert(0, todo)
    _save_json(TODOS_FILE, todos)
    return jsonify({"todo": todo}), 201

@app.route("/api/todos/<tid>", methods=["PATCH"])
def api_patch_todo(tid):
    data = request.get_json() or {}
    todos = _load_json(TODOS_FILE, [])
    for t in todos:
        if t["id"] == tid:
            if "completed" in data:
                t["completedAt"] = datetime.now(timezone.utc).isoformat() if data["completed"] else None
            # 显式指定完成时间（如在复盘日历上挪动已完成目标到其他日期）
            if "completedAt" in data:
                t["completedAt"] = data["completedAt"]
            if "title" in data:
                t["title"] = data["title"]
            if "tag" in data:
                t["tag"] = data["tag"]
            if "priority" in data:
                t["priority"] = data["priority"]
            break
    _save_json(TODOS_FILE, todos)
    return jsonify({"ok": True})

@app.route("/api/todos/<tid>", methods=["DELETE"])
def api_delete_todo(tid):
    todos = _load_json(TODOS_FILE, [])
    todos = [t for t in todos if t["id"] != tid]
    _save_json(TODOS_FILE, todos)
    return jsonify({"ok": True})

@app.route("/api/reviews", methods=["GET"])
def api_reviews():
    reviews = _load_json(REVIEWS_FILE, [])
    # 合并 Notion 复盘库（ChromaDB source=notion, database=复盘）
    try:
        coll = get_knowledge_collection()
        data = coll.get(limit=500, include=["documents", "metadatas"])
        local_titles = {r.get("title", "") for r in reviews if r.get("title")}
        for i, doc in enumerate(data.get("documents", []) or []):
            meta = (data.get("metadatas") or [{}])[i] or {}
            if meta.get("database") != "复盘" or meta.get("source") != "notion":
                continue
            title = meta.get("title", "")
            if title and title in local_titles:
                continue
            page_id = meta.get("page_id", "")
            date_str = (meta.get("review_date") or meta.get("created_at") or meta.get("updated_at") or "")[:10]
            if not date_str:
                continue
            reviews.append({
                "id": f"notion_{page_id.replace('-', '')}",
                "date": date_str,
                "type": "daily",
                "content": doc[:1000],
                "title": title,
                "aiInsights": meta.get("summary") or meta.get("ai_summary", ""),
                "notionPageId": page_id,
                "createdAt": meta.get("created_at", ""),
            })
    except Exception:
        pass
    reviews.sort(key=lambda r: r.get("date", ""), reverse=True)
    return jsonify({"reviews": reviews})

@app.route("/api/reviews", methods=["POST"])
def api_create_review():
    data = request.get_json() or {}
    content = data.get("content", "")
    review = {
        "id": str(_uuid.uuid4()),
        "date": data.get("date", ""),
        "type": data.get("type", "daily"),
        "content": content,
        "aiInsights": data.get("aiInsights", ""),
        "title": data.get("title", ""),
        "notionPageId": None,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    # 自动生成 AI 总结
    if content and len(content) >= 8 and not review["aiInsights"]:
        cfg = load_config()
        if cfg:
            try:
                syncer = NotionSync(cfg)
                summary = syncer.generate_summary(content)
                if summary:
                    review["aiInsights"] = summary
            except Exception:
                pass
    reviews = _load_json(REVIEWS_FILE, [])
    reviews.insert(0, review)
    _save_json(REVIEWS_FILE, reviews)
    _chroma_index_review(review)
    return jsonify({"review": review}), 201

@app.route("/api/reviews/<rid>", methods=["PATCH"])
def api_patch_review(rid):
    data = request.get_json() or {}
    reviews = _load_json(REVIEWS_FILE, [])
    for r in reviews:
        if r["id"] == rid:
            if "date" in data:
                r["date"] = data["date"]
            if "content" in data:
                r["content"] = data["content"]
                # 内容更新后重新生成 AI 总结
                new_content = data["content"]
                if new_content and len(new_content) >= 8:
                    cfg = load_config()
                    if cfg:
                        try:
                            syncer = NotionSync(cfg)
                            summary = syncer.generate_summary(new_content)
                            if summary:
                                r["aiInsights"] = summary
                        except Exception:
                            pass
            if "type" in data:
                r["type"] = data["type"]
            if "title" in data:
                r["title"] = data["title"]
            break
    _save_json(REVIEWS_FILE, reviews)
    updated = next((r for r in reviews if r["id"] == rid), None)
    if updated:
        _chroma_index_review(updated)
    return jsonify({"ok": True})

@app.route("/api/reviews/<rid>", methods=["DELETE"])
def api_delete_review(rid):
    reviews = _load_json(REVIEWS_FILE, [])
    reviews = [r for r in reviews if r["id"] != rid]
    _save_json(REVIEWS_FILE, reviews)
    _chroma_deindex_review(rid)
    return jsonify({"ok": True})

def _chroma_index_review(review):
    """将本地复盘 upsert 到 ChromaDB knowledge collection。"""
    try:
        coll = get_knowledge_collection()
        doc_id = f"local_review_{review['id'].replace('-', '')}"
        title = review.get("title") or f"{review.get('date', '')} 复盘"
        content = review.get("content", "") or title
        coll.upsert(
            ids=[doc_id],
            documents=[content],
            metadatas=[{
                "title": title,
                "source": "local_review",
                "database": "复盘",
                "page_id": review["id"],
                "updated_at": datetime.now().isoformat(),
                "created_at": review.get("createdAt", ""),
            }],
        )
    except Exception as e:
        log(f"⚠️ 复盘写入向量库失败: {e}")


def _chroma_deindex_review(rid):
    """从 ChromaDB 删除本地复盘。"""
    try:
        coll = get_knowledge_collection()
        coll.delete(ids=[f"local_review_{rid.replace('-', '')}"])
    except Exception as e:
        log(f"⚠️ 复盘从向量库删除失败: {e}")


# ============ 启动入口 ============
if __name__ == "__main__":
    log("🚀 AI System 同步服务启动")
    config = load_config()

    if config:
        log(f"📄 数据库: {list(config['notion']['databases'].keys())}")
        lm_cfg = config.get("lm_studio", {})
        log(f"🤖 LM Studio: {lm_cfg.get('url', 'http://localhost:1234/v1')}")

        interval = config.get("sync", {}).get("interval", 3600)
        if interval > 0:
            start_sync_thread(interval)
            log(f"⏰ 自动同步间隔: {interval} 秒")
        else:
            log("⏰ 自动同步已禁用")
    else:
        log("⚠️ 配置文件不存在，请创建 config/notion.yaml")

    # 补全历史本地复盘到向量库
    try:
        existing_reviews = _load_json(REVIEWS_FILE, [])
        if existing_reviews:
            for r in existing_reviews:
                _chroma_index_review(r)
            log(f"📥 已同步 {len(existing_reviews)} 条本地复盘到向量库")
    except Exception as e:
        log(f"⚠️ 复盘补全失败: {e}")

    # Web 服务端口
    port = config.get("web", {}).get("port", 5100) if config else 5100
    log(f"🌐 监控面板: http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
