#!/usr/bin/env python3
"""
Notion <-> Open WebUI 双向同步服务
同步 WebUI Notes（笔记）到 Notion AI笔记
"""
import os
import time
import yaml
import json
import hashlib
import sqlite3
import requests
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify
import chromadb

BASE_DIR = Path("/app") if Path("/app").exists() else Path.home() / "ai-system"
DATA_DIR = BASE_DIR / "data"
CONFIG_PATH = BASE_DIR / "config/notion.yaml"
SYNC_STATE_PATH = DATA_DIR / "sync_state.json"
CHROMA_PATH = DATA_DIR / "vector-db"
WEBUI_DB_PATH = "/webui-data/webui.db"

NOTION_API = "https://api.notion.com/v1"

app = Flask(__name__)

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def format_uuid(raw_id):
    clean_id = raw_id.replace('-', '')
    if len(clean_id) == 32:
        return f"{clean_id[:8]}-{clean_id[8:12]}-{clean_id[12:16]}-{clean_id[16:20]}-{clean_id[20:]}"
    return raw_id

def load_config():
    if not CONFIG_PATH.exists():
        return None
    with open(CONFIG_PATH, 'r') as f:
        return yaml.safe_load(f)

def load_state():
    if SYNC_STATE_PATH.exists():
        try:
            with open(SYNC_STATE_PATH, 'r') as f:
                return json.load(f)
        except:
            pass
    return {"last_sync": None, "synced_notes": {}}

def save_state(state):
    with open(SYNC_STATE_PATH, 'w') as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


class NotionSync:
    def __init__(self, config):
        self.config = config
        self.token = config['notion']['token']
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28"
        }
        self.chroma = chromadb.PersistentClient(path=str(CHROMA_PATH))
        self.collection = self.chroma.get_or_create_collection("knowledge")
        self.ai_model = config.get('ai', {}).get('model', 'qwen2.5:14b-instruct')
        self.ollama_url = "http://host.docker.internal:11434"
        self.flow = config.get('notes', {}).get('flow', 'bidirectional')

    # ==================== Notion API ====================

    def query_database_all(self, db_id):
        formatted_id = format_uuid(db_id)
        url = f"{NOTION_API}/databases/{formatted_id}/query"
        all_pages = []
        has_more = True
        start_cursor = None

        while has_more:
            payload = {}
            if start_cursor:
                payload['start_cursor'] = start_cursor
            try:
                response = requests.post(url, headers=self.headers, json=payload)
                if response.status_code != 200:
                    log(f"    ❌ API 错误: {response.status_code}")
                    break
                data = response.json()
                all_pages.extend(data.get('results', []))
                has_more = data.get('has_more', False)
                start_cursor = data.get('next_cursor')
            except Exception as e:
                log(f"    ❌ 查询失败: {e}")
                break
        return all_pages

    def get_page_content(self, page_id):
        try:
            url = f"{NOTION_API}/blocks/{page_id}/children"
            response = requests.get(url, headers=self.headers)
            if response.status_code != 200:
                return ""
            blocks = response.json().get('results', [])
            content = []
            for block in blocks:
                block_type = block.get('type')
                if block_type in ['paragraph', 'heading_1', 'heading_2', 'heading_3',
                                   'bulleted_list_item', 'numbered_list_item', 'to_do']:
                    rich_text = block.get(block_type, {}).get('rich_text', [])
                    text = ''.join([t.get('plain_text', '') for t in rich_text])
                    if text:
                        content.append(text)
            return '\n'.join(content)
        except:
            return ""

    def get_page_title(self, page):
        props = page.get('properties', {})
        for key, value in props.items():
            if value.get('type') == 'title':
                title_arr = value.get('title', [])
                if title_arr:
                    return title_arr[0].get('plain_text', '')
        return ''

    def find_title_property(self, page):
        props = page.get('properties', {})
        for key, value in props.items():
            if value.get('type') == 'title':
                return key
        return '名称'

    def generate_title(self, content):
        if not content:
            return "无标题"
        try:
            prompt = f"请为以下内容生成一个简短的标题（10字以内），只输出标题：\n\n{content[:500]}"
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json={"model": self.ai_model, "prompt": prompt, "stream": False, "options": {"num_predict": 30}},
                timeout=30
            )
            if response.status_code == 200:
                title = response.json().get('response', '').strip().replace('"', '').replace("'", '')
                if title and len(title) < 50:
                    return title
        except:
            pass
        return content[:15].replace('\n', ' ') + "..."

    def update_page_title(self, page_id, title, title_property='名称'):
        try:
            url = f"{NOTION_API}/pages/{page_id}"
            payload = {"properties": {title_property: {"title": [{"text": {"content": title}}]}}}
            response = requests.patch(url, headers=self.headers, json=payload)
            return response.status_code == 200
        except:
            return False

    def create_notion_page(self, db_id, title, content):
        try:
            formatted_id = format_uuid(db_id)
            # 把内容分成 2000 字符的块
            blocks = []
            for i in range(0, len(content), 2000):
                chunk = content[i:i+2000]
                blocks.append({
                    "object": "block",
                    "type": "paragraph",
                    "paragraph": {
                        "rich_text": [{"type": "text", "text": {"content": chunk}}]
                    }
                })

            payload = {
                "parent": {"database_id": formatted_id},
                "properties": {
                    "名称": {"title": [{"text": {"content": title}}]}
                },
                "children": blocks[:100]
            }

            response = requests.post(f"{NOTION_API}/pages", headers=self.headers, json=payload)
            if response.status_code == 200:
                return response.json().get('id')
            else:
                log(f"    ❌ 创建页面失败: {response.status_code}")
                return None
        except Exception as e:
            log(f"    ❌ 创建异常: {e}")
            return None

    # ==================== WebUI Notes ====================

    def get_webui_notes(self):
        """获取 Open WebUI 的笔记"""
        if not os.path.exists(WEBUI_DB_PATH):
            log("  ⚠️ WebUI 数据库不存在")
            return []

        try:
            conn = sqlite3.connect(WEBUI_DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id, title, data, created_at, updated_at FROM note")
            rows = cursor.fetchall()
            conn.close()

            notes = []
            for row in rows:
                note_id, title, data_json, created_at, updated_at = row
                content = ""
                try:
                    data = json.loads(data_json) if isinstance(data_json, str) else data_json
                    content = data.get('content', {}).get('md', '') if isinstance(data, dict) else ''
                except:
                    pass

                if content:
                    notes.append({
                        "id": note_id,
                        "title": title or "",
                        "content": content,
                        "created_at": created_at,
                        "updated_at": updated_at
                    })

            return notes
        except Exception as e:
            log(f"  ❌ 读取 WebUI 笔记失败: {e}")
            return []

    def sync_notes_to_notion(self):
        """同步 WebUI 笔记到 Notion AI笔记"""
        log("  📤 WebUI 笔记 → Notion AI笔记")

        ai_notes_id = self.config['notion']['databases'].get('AI笔记')
        if not ai_notes_id:
            log("    ⚠️ AI笔记数据库未配置")
            return 0

        # 获取 WebUI 笔记
        webui_notes = self.get_webui_notes()
        log(f"    WebUI 笔记: {len(webui_notes)} 条")

        if not webui_notes:
            return 0

        # 获取已同步记录
        state = load_state()
        synced_notes = state.get('synced_notes', {})

        # 获取 Notion 已有页面标题
        notion_pages = self.query_database_all(ai_notes_id)
        notion_titles = set()
        for p in notion_pages:
            t = self.get_page_title(p)
            if t:
                notion_titles.add(t)

        synced = 0
        for note in webui_notes:
            # 已同步过
            if note['id'] in synced_notes:
                continue

            title = note['title']
            content = note['content']

            # 检查是否已存在
            if title in notion_titles:
                synced_notes[note['id']] = 'exists'
                continue

            # 创建 Notion 页面
            page_id = self.create_notion_page(ai_notes_id, title, content)
            if page_id:
                synced_notes[note['id']] = page_id
                synced += 1
                log(f"    ✓ {title}")

        state['synced_notes'] = synced_notes
        save_state(state)
        return synced

    # ==================== 数据库同步 ====================

    def sync_database(self, db_name, db_id):
        log(f"  📚 同步: {db_name}")
        pages = self.query_database_all(db_id)
        log(f"    找到 {len(pages)} 个页面")

        synced = 0
        titles_generated = 0
        auto_title = self.config.get('review', {}).get('auto_title', False)

        for page in pages:
            page_id = page['id']
            current_title = self.get_page_title(page)
            content = self.get_page_content(page_id)

            if not content:
                continue

            if auto_title and not current_title.strip():
                new_title = self.generate_title(content)
                title_prop = self.find_title_property(page)
                if self.update_page_title(page_id, new_title, title_prop):
                    log(f"    🏷️ 生成标题: {new_title}")
                    current_title = new_title
                    titles_generated += 1

            doc_id = f"notion_{page_id.replace('-', '')}"
            self.collection.upsert(
                ids=[doc_id],
                documents=[content],
                metadatas=[{
                    "title": current_title or "无标题",
                    "source": "notion",
                    "database": db_name,
                    "page_id": page_id,
                    "updated_at": datetime.now().isoformat()
                }]
            )
            synced += 1

        log(f"    ✅ 同步 {synced} 页, 生成 {titles_generated} 个标题")
        return synced

    def sync_all(self):
        log("🔄 开始同步...")

        # WebUI 笔记 → Notion
        if self.flow in ['webui_to_notion', 'bidirectional']:
            notes_synced = self.sync_notes_to_notion()
            log(f"  📤 笔记同步: {notes_synced} 条新笔记")

        # Notion → 向量库
        databases = self.config['notion'].get('databases', {})
        total = 0
        for db_name, db_id in databases.items():
            count = self.sync_database(db_name, db_id)
            total += count

        state = load_state()
        state['last_sync'] = datetime.now().isoformat()
        save_state(state)

        log(f"✅ 完成，共 {total} 个页面")
        return total

    def search(self, query, limit=5):
        try:
            results = self.collection.query(query_texts=[query], n_results=limit)
            items = []
            if results and results['documents']:
                for i, doc in enumerate(results['documents'][0]):
                    meta = results['metadatas'][0][i] if results['metadatas'] else {}
                    items.append({
                        "title": meta.get('title', 'Untitled'),
                        "content": doc[:1000],
                        "source": meta.get('source', 'unknown'),
                        "database": meta.get('database', ''),
                    })
            return items
        except Exception as e:
            log(f"❌ 搜索失败: {e}")
            return []


syncer = None

def get_syncer():
    global syncer
    if syncer is None:
        config = load_config()
        if config:
            syncer = NotionSync(config)
    return syncer


@app.route('/')
def index():
    return jsonify({"status": "ok"})

@app.route('/sync', methods=['POST'])
def do_sync():
    s = get_syncer()
    if not s:
        return jsonify({"error": "配置不存在"}), 500
    count = s.sync_all()
    return jsonify({"success": True, "synced": count})

@app.route('/search', methods=['POST'])
def do_search():
    s = get_syncer()
    if not s:
        return jsonify({"error": "配置不存在"}), 500
    data = request.json or {}
    query = data.get('query', '')
    limit = data.get('limit', 5)
    if not query:
        return jsonify({"results": []})
    return jsonify({"results": s.search(query, limit)})

@app.route('/status')
def status():
    state = load_state()
    config = load_config()
    count = 0
    try:
        s = get_syncer()
        if s:
            count = s.collection.count()
    except:
        pass
    return jsonify({
        "last_sync": state.get('last_sync'),
        "databases": list(config['notion']['databases'].keys()) if config else [],
        "documents": count,
        "flow": config.get('notes', {}).get('flow', 'bidirectional') if config else None
    })


if __name__ == '__main__':
    log("🚀 启动同步服务...")
    config = load_config()
    if config:
        log(f"📄 数据库: {list(config['notion']['databases'].keys())}")
        log(f"🔄 同步模式: {config.get('notes', {}).get('flow', 'bidirectional')}")
        try:
            s = get_syncer()
            if s:
                s.sync_all()
        except Exception as e:
            log(f"❌ 初始同步失败: {e}")
            import traceback
            traceback.print_exc()

    app.run(host='0.0.0.0', port=5100, debug=False)
