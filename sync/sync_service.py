#!/usr/bin/env python3
"""
AI System 同步服务
- Notion → ChromaDB 向量库同步
- LM Studio AI 标题生成
- Web 监控界面
- 后台常驻，自动按 interval 同步
"""
import os
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
from flask import Flask, request, jsonify, render_template_string

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

# 全局状态
_service_running = False
_sync_thread = None
_lm_models_cache = []
_last_sync_result = None


# ============ 日志 ============
def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_DIR / "sync.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ============ 工具函数 ============
def format_uuid(raw_id):
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

        # ChromaDB 向量库
        VECTOR_DB_PATH.mkdir(parents=True, exist_ok=True)
        self.chroma = chromadb.PersistentClient(path=str(VECTOR_DB_PATH))
        self.collection = self.chroma.get_or_create_collection("knowledge")

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

    # ---- AI 标题生成 ----
    def generate_title(self, content, model=None):
        if not content:
            return "无标题"
        model = model or self.default_model
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
        auto_title = self.config.get("review", {}).get("auto_title", False)
        auto_title_model = self.config.get("review", {}).get("auto_title_model", None)

        for page in pages:
            page_id = page["id"]
            current_title = self.get_page_title(page)
            content = self.get_page_content(page_id)

            if not content:
                continue

            # 自动生成标题（仅对闪念和复盘，无标题时）
            if auto_title and not current_title.strip() and db_name in ["闪念", "复盘"]:
                new_title = self.generate_title(content, model=auto_title_model)
                title_prop = self.find_title_property(page)
                if self.update_page_title(page_id, new_title, title_prop):
                    log(f"    🏷️ 生成标题: {new_title}")
                    current_title = new_title
                    titles_generated += 1

            # 存入向量库
            doc_id = f"notion_{page_id.replace('-', '')}"
            self.collection.upsert(
                ids=[doc_id],
                documents=[content],
                metadatas=[{
                    "title": current_title or "无标题",
                    "source": "notion",
                    "database": db_name,
                    "page_id": page_id,
                    "updated_at": datetime.now().isoformat(),
                }],
            )
            synced += 1

        log(f"    ✅ 同步 {synced} 页, 生成 {titles_generated} 个标题")
        return synced

    # ---- 全量同步 ----
    def sync_all(self):
        log("🔄 开始同步...")
        databases = self.config["notion"].get("databases", {})
        total = 0
        for db_name, db_id in databases.items():
            count = self.sync_database(db_name, db_id)
            total += count

        state = load_state()
        state["last_sync"] = datetime.now().isoformat()
        save_state(state)

        log(f"✅ 完成，共 {total} 个页面")
        return total

    # ---- 搜索 ----
    def search(self, query, limit=5):
        try:
            results = self.collection.query(query_texts=[query], n_results=limit)
            items = []
            if results and results.get("documents"):
                for i, doc in enumerate(results["documents"][0]):
                    meta = (results.get("metadatas") or [[{}]])[0][i]
                    items.append({
                        "title": meta.get("title", "Untitled"),
                        "content": doc[:1000],
                        "source": meta.get("source", "unknown"),
                        "database": meta.get("database", ""),
                        "page_id": meta.get("page_id", ""),
                    })
            return items
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


# ============ Web 监控页面 HTML ============
MONITOR_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI System · SecondBrain</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: #f8fafc;
  color: #0f172a;
  min-height: 100vh;
  display: flex;
  font-size: 13px;
}

/* ====== LEFT SIDEBAR ====== */
.sidebar {
  width: 220px;
  min-height: 100vh;
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
.sidebar-logo {
  padding: 20px 16px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-mark {
  width: 32px; height: 32px;
  background: #0f172a;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.logo-mark span { color: #fff; font-size: 12px; font-weight: 800; }
.logo-text { font-size: 14px; font-weight: 800; color: #0f172a; }
.logo-sub { font-size: 9px; color: #94a3b8; font-weight: 400; }

.sidebar-search {
  padding: 0 16px 16px;
}
.search-box {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex; align-items: center; gap: 6px;
  cursor: pointer;
}
.search-box span { font-size: 11px; color: #94a3b8; }
.search-box .key {
  margin-left: auto;
  background: #e2e8f0;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 9px;
  color: #64748b;
  font-family: inherit;
}

.nav-section { padding: 0 12px; margin-bottom: 4px; }
.nav-label { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase;
              letter-spacing: 0.05em; padding: 8px 4px 4px; }
.nav-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  font-size: 12px; font-weight: 500;
  color: #475569;
  cursor: pointer;
  transition: all 0.1s;
  text-decoration: none;
}
.nav-item:hover { background: #f1f5f9; color: #0f172a; }
.nav-item.active {
  background: #eef2ff;
  color: #4338ca;
  font-weight: 700;
}
.nav-item.active .nav-icon { filter: none; }
.nav-icon { font-size: 14px; }
.nav-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  margin-left: auto;
}
.nav-dot.green { background: #10b981; }
.nav-dot.yellow { background: #f59e0b; }
.nav-dot.red { background: #ef4444; }

.sidebar-footer {
  margin-top: auto;
  padding: 16px;
  border-top: 1px solid #e2e8f0;
}
.model-status {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
}
.model-status-top {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 4px;
}
.model-name { font-size: 11px; font-weight: 700; color: #0f172a; }
.model-sub { font-size: 9px; color: #64748b; }
.model-btn { margin-left: auto; font-size: 12px; color: #94a3b8; cursor: pointer; }

/* ====== MAIN CONTENT ====== */
.main { flex: 1; padding: 0; overflow: hidden; }

/* Top bar */
.topbar {
  padding: 20px 28px 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.topbar-left h1 {
  font-size: 18px; font-weight: 800; color: #0f172a;
  letter-spacing: -0.01em;
}
.topbar-left .subtitle {
  font-size: 11px; color: #64748b; margin-top: 2px;
}
.topbar-right { display: flex; gap: 8px; align-items: center; }

.btn-primary {
  background: #0f172a; color: #fff;
  border: none; border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit;
  display: flex; align-items: center; gap: 5px;
}
.btn-primary:hover { background: #1e293b; }
.btn-primary .icon { font-size: 13px; }

.btn-ghost {
  background: #f1f5f9; color: #334155;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.btn-ghost:hover { background: #e2e8f0; }

.btn-icon {
  width: 32px; height: 32px;
  border-radius: 8px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 14px;
}
.btn-icon:hover { background: #e2e8f0; }

/* Content area */
.content { padding: 16px 28px 28px; }

/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 16px 18px;
}
.stat-card .label { font-size: 10px; font-weight: 700; color: #94a3b8;
                    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.stat-card .value { font-size: 26px; font-weight: 800; color: #0f172a;
                    letter-spacing: -0.02em; line-height: 1.1; }
.stat-card .sub { font-size: 10px; color: #64748b; margin-top: 4px; }
.stat-card .badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 600; padding: 2px 7px;
  border-radius: 9999px; margin-top: 4px;
}
.badge.green { background: #f0fdf4; color: #15803d; }
.badge.blue { background: #eff6ff; color: #1d4ed8; }
.badge.orange { background: #fef3c7; color: #92400e; }
.dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.dot.green { background: #10b981; }
.dot.yellow { background: #f59e0b; }
.dot.red { background: #ef4444; }

/* Main grid */
.main-grid {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 16px;
}

/* Cards */
.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  overflow: hidden;
}
.card-header {
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
  display: flex; align-items: center; justify-content: space-between;
}
.card-title { font-size: 12px; font-weight: 700; color: #0f172a; }
.card-more { font-size: 11px; color: #6366f1; text-decoration: none; cursor: pointer; }
.card-more:hover { text-decoration: underline; }
.card-body { padding: 14px 18px; }

/* AI hero card */
.ai-hero {
  background: #0f172a;
  border-radius: 20px;
  padding: 24px;
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
}
.ai-hero::before {
  content: '';
  position: absolute;
  top: -40px; right: -40px;
  width: 180px; height: 180px;
  background: radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%);
  pointer-events: none;
}
.ai-hero-badge {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(99,102,241,0.2);
  border: 1px solid rgba(99,102,241,0.3);
  border-radius: 9999px;
  padding: 3px 10px;
  font-size: 10px; font-weight: 600;
  color: #a5b4fc;
  margin-bottom: 10px;
}
.ai-hero h2 { font-size: 20px; font-weight: 800; color: #fff; margin-bottom: 6px; }
.ai-hero p { font-size: 12px; color: #94a3b8; margin-bottom: 16px; }
.ai-hero input {
  width: 100%;
  background: #1e293b;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  padding: 11px 14px;
  font-size: 12px;
  color: #f1f5f9;
  font-family: inherit;
  outline: none;
  margin-bottom: 12px;
}
.ai-hero input::placeholder { color: #64748b; }
.ai-hero input:focus { border-color: rgba(99,102,241,0.5); }

/* Quick scenes */
.scenes-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.scene-btn {
  background: #1e293b;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.scene-btn:hover { background: #334155; border-color: rgba(255,255,255,0.1); }
.scene-icon { font-size: 14px; margin-bottom: 4px; }
.scene-title { font-size: 11px; font-weight: 700; color: #fff; }
.scene-sub { font-size: 9px; color: #64748b; margin-top: 1px; }
.scene-arrow { font-size: 9px; color: #6366f1; margin-top: 4px; }

/* Model chips */
.model-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.model-chip {
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 11px; font-weight: 600;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  cursor: pointer;
  transition: all 0.1s;
}
.model-chip:hover { background: #f1f5f9; }
.model-chip.active {
  background: #eef2ff;
  border-color: #6366f1;
  color: #4338ca;
}
.model-chip.online::before {
  content: '';
  display: inline-block;
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #10b981;
  margin-right: 4px;
}

/* Sync card */
.sync-status-row {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 8px;
}
.sync-title { font-size: 12px; font-weight: 700; color: #0f172a; }
.sync-info { font-size: 10px; color: #64748b; margin-bottom: 10px; }
.sync-on { display: inline-flex; align-items: center; gap: 4px;
           background: #f0fdf4; border-radius: 6px; padding: 4px 8px;
           font-size: 10px; font-weight: 600; color: #15803d; margin-bottom: 10px; }

/* DB list */
.db-list { }
.db-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid #f8fafc;
  font-size: 12px;
}
.db-item:last-child { border-bottom: none; }
.db-name { color: #334155; }
.db-meta { font-size: 10px; color: #94a3b8; }
.db-dot { color: #10b981; margin-right: 3px; }

/* Log list */
.log-list { }
.log-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #f8fafc;
}
.log-item:last-child { border-bottom: none; }
.log-icon {
  width: 24px; height: 24px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  margin-top: 1px;
}
.log-content { flex: 1; min-width: 0; }
.log-title { font-size: 12px; font-weight: 500; color: #334155; }
.log-time { font-size: 10px; color: #94a3b8; margin-top: 1px; }
.log-badge {
  font-size: 10px; font-weight: 600;
  padding: 2px 7px;
  border-radius: 9999px;
  flex-shrink: 0;
}
.log-badge.ok { background: #f0fdf4; color: #15803d; }
.log-badge.run { background: #fef3c7; color: #92400e; }
.log-badge.err { background: #fef2f2; color: #b91c1c; }
.log-badge.info { background: #f1f5f9; color: #475569; }

/* Right panel cards */
.right-panel { display: flex; flex-direction: column; gap: 12px; }

/* System status */
.sys-status { }
.status-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #f8fafc;
  font-size: 12px;
}
.status-row:last-child { border-bottom: none; }
.status-label { color: #475569; }
.status-val { font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
.status-val.ok { color: #15803d; }
.status-val.warn { color: #92400e; }
.status-val.err { color: #b91c1c; }

/* Collection stats */
.col-stat { display: flex; justify-content: space-between; align-items: center;
            padding: 6px 0; border-bottom: 1px solid #f8fafc; font-size: 12px; }
.col-stat:last-child { border-bottom: none; }
.col-name { color: #334155; font-weight: 500; }
.col-count { color: #64748b; }

/* Search card */
.search-card { }
.search-input-wrap {
  display: flex; gap: 6px; margin-bottom: 12px;
}
.search-input-wrap input {
  flex: 1;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #0f172a;
  font-family: inherit;
  outline: none;
}
.search-input-wrap input:focus { border-color: #6366f1; }
.search-input-wrap input::placeholder { color: #94a3b8; }
.btn-search {
  background: #6366f1; color: #fff;
  border: none; border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.btn-search:hover { background: #4f46e5; }

/* Search results */
.search-results { }
.search-result {
  padding: 8px 0;
  border-bottom: 1px solid #f8fafc;
}
.search-result:last-child { border-bottom: none; }
.search-result-title { font-size: 12px; font-weight: 600; color: #0f172a; }
.search-result-meta { font-size: 10px; color: #94a3b8; margin-top: 2px; }
.search-result-content { font-size: 11px; color: #64748b; margin-top: 4px;
                         overflow: hidden; text-overflow: ellipsis;
                         display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

/* Model select in sidebar */
.model-select-wrap {
  padding: 12px 16px;
}
.model-select-label { font-size: 9px; font-weight: 700; color: #94a3b8;
                      text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.model-select {
  width: 100%;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  color: #334155;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}
.model-select:focus { border-color: #6366f1; }
.model-select option { background: #fff; }

/* Section label */
.section-label { font-size: 9px; font-weight: 700; color: #94a3b8;
                  text-transform: uppercase; letter-spacing: 0.05em;
                  padding: 12px 18px 6px; }

/* Loading / empty state */
.empty-state { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
.loading-dots { display: inline-block; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

/* Responsive */
@media (max-width: 900px) {
  .main-grid { grid-template-columns: 1fr; }
  .stats-row { grid-template-columns: repeat(2, 1fr); }
  .sidebar { display: none; }
}
</style>
</head>
<body>

<!-- ====== LEFT SIDEBAR ====== -->
<aside class="sidebar">
  <div class="sidebar-logo">
    <div class="logo-mark"><span>SB</span></div>
    <div>
      <div class="logo-text">SecondBrain</div>
      <div class="logo-sub">AI System · v3.0</div>
    </div>
  </div>

  <div class="sidebar-search">
    <div class="search-box" onclick="focusSearch()">
      <span>🔍 搜索知识库...</span>
      <span class="key">⌘K</span>
    </div>
  </div>

  <div class="nav-section">
    <div class="nav-label">Main</div>
    <div class="nav-item active" onclick="showTab('overview')">
      <span class="nav-icon">🏠</span> 概览
    </div>
    <div class="nav-item" onclick="showTab('chat')">
      <span class="nav-icon">💬</span> AI 对话
    </div>
    <div class="nav-item" onclick="showTab('search')">
      <span class="nav-icon">🔍</span> 搜索
    </div>
    <div class="nav-item" onclick="showTab('settings')">
      <span class="nav-icon">⚙️</span> 设置
    </div>
  </div>

  <div class="nav-section">
    <div class="nav-label">数据源</div>
    <div class="nav-item">
      <span class="nav-icon">🗂️</span> Notion
      <span class="nav-dot green"></span>
    </div>
    <div class="nav-item">
      <span class="nav-icon">📁</span> 本地笔记
      <span class="nav-dot green"></span>
    </div>
  </div>

  <div class="nav-section">
    <div class="nav-label">最近对话</div>
    <div class="nav-item" style="font-size:11px;padding:5px 8px;">
      <span style="color:#94a3b8;font-size:10px;">暂无对话记录</span>
    </div>
  </div>

  <div class="sidebar-footer">
    <div class="model-select-wrap">
      <div class="model-select-label">当前模型</div>
      <select class="model-select" id="model-select" onchange="setModel()">
        <option value="">加载中...</option>
      </select>
    </div>
  </div>
</aside>

<!-- ====== MAIN CONTENT ====== -->
<main class="main">

  <!-- Top bar -->
  <div class="topbar">
    <div class="topbar-left">
      <h1 id="page-title">知识库概览</h1>
      <div class="subtitle" id="page-subtitle">实时同步状态 · 向量数据库 · 模型管理</div>
    </div>
    <div class="topbar-right">
      <button class="btn-primary" onclick="doSync()">
        <span class="icon">⚡</span> 一键同步全部
      </button>
      <div class="btn-icon" onclick="loadAll()" title="刷新">↻</div>
    </div>
  </div>

  <!-- Content -->
  <div class="content">

    <!-- Stats row -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="label">向量文档</div>
        <div class="value" id="stat-docs">—</div>
        <div class="sub" id="stat-collections">— 个 Collection</div>
      </div>
      <div class="stat-card">
        <div class="label">最后同步</div>
        <div class="value" style="font-size:18px;" id="stat-last-sync">—</div>
        <div class="sub" id="stat-sync-ago"></div>
      </div>
      <div class="stat-card">
        <div class="label">服务状态</div>
        <div class="value" style="font-size:16px;" id="stat-service">
          <span class="loading-dots">...</span>
        </div>
        <div class="sub" id="stat-model-name">—</div>
      </div>
      <div class="stat-card">
        <div class="label">API 状态</div>
        <div class="value" style="font-size:16px;" id="stat-api">
          <span class="loading-dots">...</span>
        </div>
        <div class="sub" id="stat-api-sub">LM Studio + Notion</div>
      </div>
    </div>

    <!-- Main grid -->
    <div class="main-grid">

      <!-- Left column -->
      <div>

        <!-- AI Hero + Search -->
        <div class="ai-hero">
          <div class="ai-hero-badge">🤖 AI 助手 · <span id="model-status-badge">本地模型已就绪</span></div>
          <h2>今天想思考什么？</h2>
          <p id="hero-desc">输入问题，基于你的 <span id="hero-docs-count">—</span> 条笔记和向量数据库回答</p>
          <input id="search-input-hero" placeholder="💬 输入问题，按回车搜索知识库..." onkeydown="if(event.key==='Enter')doHeroSearch()">
          <div class="scenes-grid">
            <button class="scene-btn" onclick="quickSearch('本周复盘')">
              <div class="scene-icon">🎯</div>
              <div class="scene-title">本周复盘</div>
              <div class="scene-sub">基于笔记生成洞察</div>
              <div class="scene-arrow">→ 立即开始</div>
            </button>
            <button class="scene-btn" onclick="quickSearch('知识盲点扫描')">
              <div class="scene-icon">🔍</div>
              <div class="scene-title">知识盲点扫描</div>
              <div class="scene-sub">找出你没意识到的缺口</div>
              <div class="scene-arrow">→ 扫描全库</div>
            </button>
            <button class="scene-btn" onclick="quickSearch('学习路径推荐')">
              <div class="scene-icon">🧭</div>
              <div class="scene-title">学习路径推荐</div>
              <div class="scene-sub">下一步该学什么？</div>
              <div class="scene-arrow">→ 让 AI 规划</div>
            </button>
            <button class="scene-btn" onclick="quickSearch('灵感关联')">
              <div class="scene-icon">💡</div>
              <div class="scene-title">灵感关联</div>
              <div class="scene-sub">连接不同领域的想法</div>
              <div class="scene-arrow">→ 探索关联</div>
            </button>
          </div>
          <div class="model-chips" id="model-chips">
            <span class="model-chip active" onclick="selectModelChip(this)">qwen2.5:14b</span>
            <span class="model-chip" onclick="selectModelChip(this)">qwen3:14b</span>
            <span class="model-chip" onclick="selectModelChip(this)">deepseek-coder</span>
          </div>
        </div>

        <!-- Notion Sync + Collections cards -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div class="card">
            <div class="card-header">
              <span class="card-title">NOTION 同步</span>
            </div>
            <div class="card-body">
              <div class="sync-status-row">
                <span class="dot green"></span>
                <span class="sync-title" id="notion-status-text">已连接 · 自动运行</span>
              </div>
              <div class="sync-info" id="next-sync-time">检查更新中...</div>
              <div class="sync-on">✓ AI 自动命名已开启</div>
              <div id="notion-db-list"></div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">向量数据库</span>
            </div>
            <div class="card-body">
              <div class="col-stat">
                <span class="col-name" id="col-0-name">knowledge</span>
                <span class="col-count" id="col-0-count">—</span>
              </div>
              <div class="col-stat">
                <span class="col-name" id="col-1-name">notion</span>
                <span class="col-count" id="col-1-count">—</span>
              </div>
              <div class="col-stat" style="margin-top:8px;">
                <span class="col-name" style="font-size:10px;color:#94a3b8;">向量索引状态</span>
                <span class="badge green" id="index-status">✓</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Search results (hidden by default) -->
        <div class="card" id="search-results-card" style="display:none;margin-bottom:12px;">
          <div class="card-header">
            <span class="card-title">🔍 搜索结果</span>
            <span class="card-more" onclick="hideSearchResults()">关闭</span>
          </div>
          <div class="card-body">
            <div class="search-results" id="search-results-list"></div>
          </div>
        </div>

        <!-- Recent sync log -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">最近同步记录</span>
            <span class="card-more" onclick="loadLogs()">查看全部 →</span>
          </div>
          <div class="card-body">
            <div class="log-list" id="log-list">
              <div class="empty-state">加载中<span class="loading-dots">...</span></div>
            </div>
          </div>
        </div>

      </div>

      <!-- Right column -->
      <div class="right-panel">

        <!-- System status -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">⚙️ 系统状态</span>
          </div>
          <div class="card-body sys-status">
            <div class="status-row">
              <span class="status-label">本地模型</span>
              <span class="status-val ok" id="sys-lm"><span class="dot green"></span> 正常</span>
            </div>
            <div class="status-row">
              <span class="status-label">Notion API</span>
              <span class="status-val ok" id="sys-notion"><span class="dot green"></span> 正常</span>
            </div>
            <div class="status-row">
              <span class="status-label">向量数据库</span>
              <span class="status-val ok" id="sys-chroma"><span class="dot green"></span> 正常</span>
            </div>
            <div class="status-row">
              <span class="status-label">同步服务</span>
              <span class="status-val ok" id="sys-sync"><span class="dot green"></span> 运行中</span>
            </div>
          </div>
        </div>

        <!-- Quick actions -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">⚡ 快捷操作</span>
          </div>
          <div class="card-body">
            <div class="log-item" style="padding:4px 0;border:none;" onclick="doSync()">
              <div class="log-icon" style="background:#f0fdf4;">🔄</div>
              <div class="log-content">
                <div class="log-title">同步 Notion</div>
                <div class="log-time">立即检查更新</div>
              </div>
            </div>
            <div class="log-item" style="padding:4px 0;border:none;" onclick="loadModels()">
              <div class="log-icon" style="background:#eef2ff;">🤖</div>
              <div class="log-content">
                <div class="log-title">切换模型</div>
                <div class="log-time" id="current-model-name">当前: —</div>
              </div>
            </div>
            <div class="log-item" style="padding:4px 0;border:none;" onclick="window.open('/api/logs','_blank')">
              <div class="log-icon" style="background:#fef3c7;">📋</div>
              <div class="log-content">
                <div class="log-title">查看日志</div>
                <div class="log-time">raw 日志文件</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Notion DBs -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">🗂️ Notion 数据库</span>
          </div>
          <div class="card-body">
            <div id="notion-dbs-panel"></div>
          </div>
        </div>

      </div>
    </div>
  </div>
</main>

<script>
// ---- API helpers ----
async function api(method, url, body) {
  let opts = {method, headers:{'Content-Type':'application/json'}};
  if (body) opts.body = JSON.stringify(body);
  let r = await fetch(url, opts);
  return r.json().catch(() => ({}));
}

// ---- Load all data ----
async function loadAll() {
  await Promise.all([loadStatus(), loadModels(), loadLogs(), loadNotionDBs()]);
}

async function loadStatus() {
  let s = await api('GET', '/api/status');

  // Docs stat
  let docs = s.documents ?? '—';
  document.getElementById('stat-docs').textContent = docs;
  document.getElementById('hero-docs-count').textContent = docs;

  // Collections
  let cols = s.collections || [];
  document.getElementById('stat-collections').textContent = (cols.length || '?') + ' 个 Collection';
  for (let i = 0; i < 2; i++) {
    let nameEl = document.getElementById('col-' + i + '-name');
    let countEl = document.getElementById('col-' + i + '-count');
    if (nameEl && cols[i]) nameEl.textContent = cols[i];
    if (countEl) countEl.textContent = docs + ' 条';
  }

  // Last sync
  let lastSync = s.last_sync || null;
  if (lastSync) {
    let d = lastSync.replace('T', ' ').slice(0, 19);
    document.getElementById('stat-last-sync').textContent = d.slice(11, 16);
    let ago = getTimeAgo(lastSync);
    document.getElementById('stat-sync-ago').textContent = ago + ' 前';
    document.getElementById('next-sync-time').textContent = '上次同步: ' + d;
  } else {
    document.getElementById('stat-last-sync').textContent = '从未';
    document.getElementById('stat-sync-ago').textContent = '';
  }

  // Service status
  let running = s.service_running;
  let svcEl = document.getElementById('stat-service');
  if (running) {
    svcEl.innerHTML = '<span class="dot green"></span> 运行中';
  } else {
    svcEl.innerHTML = '<span class="dot yellow"></span> 已停止';
  }

  // Sync result
  let syncEl = document.getElementById('notion-status-text');
  if (s.last_error) {
    syncEl.textContent = '❌ ' + s.last_error;
  } else if (s.last_count !== undefined) {
    syncEl.textContent = '✓ 已同步 · ' + s.last_count + ' 页';
  }

  // API status
  let apiEl = document.getElementById('stat-api');
  if (s.last_error) {
    apiEl.innerHTML = '<span class="dot red"></span> 异常';
  } else {
    apiEl.innerHTML = '<span class="dot green"></span> 正常';
  }

  // Databases
  let dbs = s.databases || [];

  // Model name
  let modelEl = document.getElementById('stat-model-name');
  let selEl = document.getElementById('model-select');
  let current = selEl.value;
  if (current) {
    modelEl.textContent = current;
  } else {
    modelEl.textContent = s.documents > 0 ? '已加载' : '—';
  }
}

async function loadModels() {
  let m = await api('GET', '/api/models');
  let models = m.models || [];
  let current = m.current || '';

  // Sidebar select
  let sel = document.getElementById('model-select');
  sel.innerHTML = '';
  if (models.length === 0) {
    let o = document.createElement('option');
    o.value = o.textContent = '无可用模型';
    sel.appendChild(o);
  } else {
    models.forEach(model => {
      let o = document.createElement('option');
      o.value = o.textContent = model;
      if (model === current) o.selected = true;
      sel.appendChild(o);
    });
  }

  // Model chips
  let chipsEl = document.getElementById('model-chips');
  chipsEl.innerHTML = '';
  models.forEach(model => {
    let chip = document.createElement('span');
    chip.className = 'model-chip online' + (model === current ? ' active' : '');
    chip.textContent = model;
    chip.onclick = () => selectModelChip(chip);
    chipsEl.appendChild(chip);
  });

  // Current model display
  document.getElementById('current-model-name').textContent = '当前: ' + (current || '未选择');
  document.getElementById('stat-model-name').textContent = current || '—';

  if (models.length > 0) {
    document.getElementById('model-status-badge').textContent = current + ' 已就绪';
  }
}

async function loadLogs() {
  let r = await api('GET', '/api/logs');
  let lines = r.lines || [];
  let el = document.getElementById('log-list');
  if (lines.length === 0) {
    el.innerHTML = '<div class="empty-state">暂无同步记录</div>';
    return;
  }
  el.innerHTML = '';
  // Show last 8
  lines.slice(-8).reverse().forEach(line => {
    let div = document.createElement('div');
    div.className = 'log-item';

    // Parse log line
    let idx = line.indexOf(']');
    let time = idx > 0 ? line.slice(1, idx) : line.slice(0, 8);
    let msg = idx > 0 ? line.slice(idx+1).trim() : line;

    let icon = '📄';
    let badge = 'info';
    if (msg.includes('✅') || msg.includes('完成')) { icon = '✓'; badge = 'ok'; }
    else if (msg.includes('开始') || msg.includes('同步')) { icon = '🔄'; badge = 'run'; }
    else if (msg.includes('❌') || msg.includes('错误') || msg.includes('失败')) { icon = '✗'; badge = 'err'; }
    else if (msg.includes('警告') || msg.includes('⚠️')) { icon = '⚠️'; badge = 'warn'; }

    let title = msg.replace(/[✅❌🔄⚠️✗]/g, '').trim().slice(0, 60);

    div.innerHTML = `
      <div class="log-icon" style="background:${badge==='ok'?'#f0fdf4':badge==='err'?'#fef2f2':badge==='run'?'#fef3c7':'#f1f5f9'}">${icon}</div>
      <div class="log-content">
        <div class="log-title">${title}</div>
        <div class="log-time">${time}</div>
      </div>
      <span class="log-badge ${badge}">${badge==='ok'?'成功':badge==='err'?'失败':badge==='run'?'进行中':'信息'}</span>
    `;
    el.appendChild(div);
  });
}

async function loadNotionDBs() {
  let s = await api('GET', '/api/status');
  let dbs = s.databases || [];
  let el = document.getElementById('notion-dbs-panel');
  el.innerHTML = '';
  dbs.forEach(db => {
    let div = document.createElement('div');
    div.className = 'db-item';
    div.innerHTML = `<span class="db-name">📋 ${db}</span><span class="db-meta"><span class="db-dot">●</span>已连接</span>`;
    el.appendChild(div);
  });

  let panelEl = document.getElementById('notion-db-list');
  panelEl.innerHTML = '';
  dbs.forEach(db => {
    let div = document.createElement('div');
    div.className = 'db-item';
    div.innerHTML = `<span class="db-name">📋 ${db}</span><span class="badge green">✓</span>`;
    panelEl.appendChild(div);
  });
}

async function doSync() {
  let btn = document.querySelector('.btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<span class="icon">⏳</span> 同步中...';
  let r = await api('POST', '/api/sync');
  btn.disabled = false;
  btn.innerHTML = '<span class="icon">⚡</span> 一键同步全部';
  await loadAll();
  if (r.error) {
    alert('同步失败: ' + r.error);
  }
}

async function setModel() {
  let model = document.getElementById('model-select').value;
  if (!model) return;
  let r = await api('POST', '/api/model', {model});
  if (r.ok) {
    await loadModels();
  }
}

function selectModelChip(el) {
  document.querySelectorAll('.model-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  let model = el.textContent;
  document.getElementById('model-select').value = model;
  setModel();
}

async function doHeroSearch() {
  let q = document.getElementById('search-input-hero').value.trim();
  if (!q) return;
  document.getElementById('search-input-hero').value = q;
  await doSearch(q);
}

async function quickSearch(q) {
  document.getElementById('search-input-hero').value = q;
  await doSearch(q);
}

async function doSearch(q) {
  let card = document.getElementById('search-results-card');
  card.style.display = 'block';
  let list = document.getElementById('search-results-list');
  list.innerHTML = '<div class="empty-state">搜索中<span class="loading-dots">...</span></div>';
  let r = await api('POST', '/api/search', {query: q, limit: 5});
  let results = r.results || [];
  if (results.length === 0) {
    list.innerHTML = '<div class="empty-state">没有找到相关结果</div>';
    return;
  }
  list.innerHTML = '';
  results.forEach(item => {
    let div = document.createElement('div');
    div.className = 'search-result';
    div.innerHTML = `
      <div class="search-result-title">📄 ${item.title || '无标题'}</div>
      <div class="search-result-meta">${item.database || item.source || ''} · 相关度评分</div>
      <div class="search-result-content">${item.content || ''}</div>
    `;
    list.appendChild(div);
  });
}

function hideSearchResults() {
  document.getElementById('search-results-card').style.display = 'none';
}

function focusSearch() {
  document.getElementById('search-input-hero').focus();
}

function showTab(tab) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

// ---- Time ago ----
function getTimeAgo(iso) {
  try {
    let diff = Date.now() - new Date(iso).getTime();
    let m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟';
    let h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时';
    return Math.floor(h / 24) + ' 天';
  } catch(e) { return ''; }
}

// ---- Init ----
loadAll();
setInterval(loadAll, 15000);
</script>
</body>
</html>
"""


# ============ Web 路由 ============
@app.route("/")
def index():
    return render_template_string(MONITOR_PAGE)


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

    result = {
        "service_running": _service_running,
        "last_sync": state.get("last_sync"),
        "last_count": _last_sync_result.get("count") if _last_sync_result else None,
        "last_error": _last_sync_result.get("error") if _last_sync_result else None,
        "documents": count,
        "collections": collections,
        "databases": list(config["notion"]["databases"].keys()) if config else [],
    }
    return jsonify(result)


@app.route("/api/sync", methods=["POST"])
def api_sync():
    global _last_sync_result
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
    config = load_config()
    models = get_lm_models(config or {})
    lm_cfg = (config or {}).get("lm_studio", {})
    current = lm_cfg.get("default_model", "")
    return jsonify({"models": models, "current": current})


@app.route("/api/model", methods=["POST"])
def api_set_model():
    data = request.json or {}
    model = data.get("model", "").strip()
    if not model:
        return jsonify({"error": "模型名为空"}), 400
    # 写回配置文件
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 500
    if "lm_studio" not in config:
        config["lm_studio"] = {}
    config["lm_studio"]["default_model"] = model
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)
    global _lm_models_cache
    _lm_models_cache = []
    return jsonify({"ok": True, "model": model})


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


@app.route("/api/notes")
def api_notes():
    """返回所有已索引的笔记（从 ChromaDB），用于搜索页实时展示"""
    try:
        client = chromadb.PersistentClient(path=str(VECTOR_DB_PATH))
        results = []
        for coll in client.list_collections():
            try:
                data = coll.get(limit=50, include=["documents", "metadatas"])
                for i, doc in enumerate(data.get("documents", []) or []):
                    meta = (data.get("metadatas") or [{}])[i] or {}
                    results.append({
                        "id": meta.get("page_id", f"chunk_{i}"),
                        "title": meta.get("title", "无标题"),
                        "content": doc[:200],
                        "database": meta.get("database", ""),
                        "updated": meta.get("updated", ""),
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
        return jsonify({"notes": unique[:50]})
    except Exception as e:
        return jsonify({"notes": [], "error": str(e)}), 500


@app.route("/api/settings")
def api_settings():
    """返回配置（敏感字段已脱敏），不含 token 明文"""
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 404
    notion = config.get("notion", {})
    lm = config.get("lm_studio", {})
    return jsonify({
        "notion": {
            "token": "****" + (notion.get("token", "")[-8:] if notion.get("token") else ""),
            "databases": notion.get("databases", {}),
        },
        "lm_studio": {
            "url": lm.get("url", "http://localhost:1234/v1"),
            "default_model": lm.get("default_model", ""),
        },
        "sync": config.get("sync", {}),
        "web": config.get("web", {}),
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

    # 更新 lm_studio
    if "lm_studio" in data:
        config["lm_studio"] = {**config.get("lm_studio", {}), **data["lm_studio"]}

    # 更新 sync
    if "sync" in data:
        config["sync"] = {**config.get("sync", {}), **data["sync"]}

    # 写回文件
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/chat", methods=["POST"])
def api_chat():
    """AI 对话：先搜知识库，再调 LM Studio 生成回答"""
    config = load_config()
    if not config:
        return jsonify({"error": "配置不存在"}), 500
    data = request.json or {}
    query = data.get("query", "")
    model = data.get("model", "") or config.get("lm_studio", {}).get("default_model", "")

    if not query:
        return jsonify({"error": "query is required"}), 400

    # 1. 搜索知识库获取上下文
    syncer = NotionSync(config)
    results = syncer.search(query, limit=5)

    # 2. 构造 prompt
    context = "\n\n".join(
        f"[{r.get('title', '未知来源')}]({r.get('source', '')}):\n{r.get('content', '')}"
        for r in results
    )
    system_prompt = (
        "你是一个智能助手，基于用户的知识库回答问题。\n"
        "如果知识库中有相关内容，请结合知识库回答。\n"
        "如果知识库中没有相关信息，请直接说明并给出通用建议。\n"
        "回答要简洁、有条理，用中文回答。\n"
    )
    user_prompt = f"知识库内容:\n{context}\n\n用户问题: {query}" if context else query

    # 3. 调用 LM Studio
    lm_url = config.get("lm_studio", {}).get("url", "http://localhost:1234/v1")
    try:
        resp = requests.post(
            f"{lm_url}/chat/completions",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.7,
                "max_tokens": 800,
            },
            timeout=60,
        )
        resp.raise_for_status()
        answer = resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        answer = f"模型调用失败: {e}。请确认 LM Studio 已加载模型且 API 可访问。"
        results = []

    return jsonify({
        "answer": answer,
        "sources": results,
        "model": model,
    })


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

    # Web 服务端口
    port = config.get("web", {}).get("port", 5100) if config else 5100
    log(f"🌐 监控面板: http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
