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
                "collections": [c["name"] for c in self.chroma.list_collections()],
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
MONITOR_PAGE = """
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI System 监控</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f1117; color: #e0e0e0; min-height: 100vh; padding: 24px; }
  h1 { color: #7c6af7; margin-bottom: 24px; font-size: 22px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px;
          padding: 20px; }
  .card .label { font-size: 12px; color: #888; margin-bottom: 6px; }
  .card .value { font-size: 24px; font-weight: 600; color: #fff; }
  .status-ok { color: #4ade80; }
  .status-err { color: #f87171; }
  .status-run { color: #60a5fa; }
  .section { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px;
             padding: 20px; margin-bottom: 16px; }
  .section h2 { font-size: 14px; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .btn { background: #7c6af7; color: #fff; border: none; border-radius: 8px;
         padding: 10px 20px; cursor: pointer; font-size: 14px; margin-right: 8px; margin-bottom: 8px; }
  .btn:hover { background: #6b5ce7; }
  .btn-danger { background: #f87171; }
  .btn-danger:hover { background: #ef4444; }
  select, input { background: #2a2d3a; color: #fff; border: 1px solid #3a3d4a;
                  border-radius: 8px; padding: 8px 12px; font-size: 14px; margin-right: 8px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #2a2d3a; font-size: 13px; }
  th { color: #888; font-weight: 500; }
  tr:hover { background: #1f2233; }
  .log-line { font-family: 'Monaco', 'Menlo', monospace; font-size: 12px;
              padding: 4px 0; border-bottom: 1px solid #1f2233; }
  .log-time { color: #555; margin-right: 8px; }
  .tag { display: inline-block; background: #2a2d3a; border-radius: 4px;
         padding: 2px 8px; font-size: 11px; margin-right: 4px; }
</style>
</head>
<body>
<h1>🤖 AI System 监控面板</h1>

<div class="cards">
  <div class="card">
    <div class="label">服务状态</div>
    <div class="value status-run" id="svc-status">运行中</div>
  </div>
  <div class="card">
    <div class="label">最后同步</div>
    <div class="value" style="font-size:14px" id="last-sync">—</div>
  </div>
  <div class="card">
    <div class="label">向量库文档数</div>
    <div class="value" id="doc-count">—</div>
  </div>
  <div class="card">
    <div class="label">同步结果</div>
    <div class="value" style="font-size:14px" id="sync-result">—</div>
  </div>
</div>

<div class="section">
  <h2>🔧 操作</h2>
  <button class="btn" onclick="doSync()">▶ 立即同步</button>
  <button class="btn" onclick="loadStatus()">↻ 刷新状态</button>
  <button class="btn" onclick="loadModels()">🔄 获取模型列表</button>
</div>

<div class="section">
  <h2>🤖 LM Studio 模型</h2>
  <div id="models-area">
    <select id="model-select" style="width:300px">
      <option value="">加载中...</option>
    </select>
    <button class="btn" onclick="setModel()">设为默认模型</button>
  </div>
  <div id="models-msg" style="color:#4ade80;font-size:13px;margin-top:6px"></div>
</div>

<div class="section">
  <h2>📊 向量库集合</h2>
  <div id="collections" style="font-size:13px;color:#aaa">—</div>
</div>

<div class="section">
  <h2>📝 同步日志（最新 50 条）</h2>
  <div id="log-area" style="max-height:400px;overflow-y:auto">
    <div id="log-lines" style="font-family:monospace;font-size:12px"></div>
  </div>
</div>

<script>
let lastResult = null;
async function api(method, url, body) {
  let opts = {method, headers:{'Content-Type':'application/json'}};
  if (body) opts.body = JSON.stringify(body);
  let r = await fetch(url, opts);
  return r.json().catch(() => ({}));
}
async function loadStatus() {
  let s = await api('GET', '/api/status');
  document.getElementById('doc-count').textContent = s.documents ?? '—';
  document.getElementById('last-sync').textContent = s.last_sync ? s.last_sync.slice(0,19).replace('T',' ') : '—';
  document.getElementById('svc-status').textContent = s.service_running ? '运行中' : '已停止';
  document.getElementById('svc-status').className = 'value ' + (s.service_running ? 'status-run' : 'status-err');
  if (s.collections) {
    document.getElementById('collections').textContent = s.collections.join(', ');
  }
  if (s.last_error) {
    document.getElementById('sync-result').innerHTML = '<span class="status-err">❌ ' + s.last_error + '</span>';
  } else if (s.last_count !== undefined) {
    document.getElementById('sync-result').innerHTML = '<span class="status-ok">✅ ' + s.last_count + ' 页</span>';
  }
  lastResult = s;
}
async function loadModels() {
  let m = await api('GET', '/api/models');
  let sel = document.getElementById('model-select');
  sel.innerHTML = '';
  (m.models || []).forEach(model => {
    let o = document.createElement('option');
    o.value = o.textContent = model;
    if (model === m.current) o.selected = true;
    sel.appendChild(o);
  });
  if (!m.models || m.models.length === 0) {
    sel.innerHTML = '<option value="">无法获取，请检查 LM Studio</option>';
  }
}
async function setModel() {
  let model = document.getElementById('model-select').value;
  if (!model) return;
  let r = await api('POST', '/api/model', {model});
  document.getElementById('models-msg').textContent = r.ok ? '✅ 已设为默认模型: ' + model : '❌ 设置失败';
}
async function doSync() {
  let r = await api('POST', '/api/sync');
  document.getElementById('sync-result').innerHTML = '<span class="status-run">⏳ 同步中...</span>';
  setTimeout(loadStatus, 2000);
}
async function loadLogs() {
  let r = await api('GET', '/api/logs');
  let el = document.getElementById('log-lines');
  el.innerHTML = '';
  (r.lines || []).forEach(line => {
    let div = document.createElement('div');
    div.className = 'log-line';
    let idx = line.indexOf(']');
    if (idx > 0) {
      div.innerHTML = '<span class="log-time">' + line.slice(1, idx) + '</span>' + line.slice(idx+1);
    } else {
      div.textContent = line;
    }
    el.appendChild(div);
  });
}
loadStatus();
loadModels();
loadLogs();
setInterval(() => { loadStatus(); loadLogs(); }, 10000);
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
