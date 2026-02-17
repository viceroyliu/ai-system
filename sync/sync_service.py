#!/usr/bin/env python3
"""
Notion <-> Open WebUI 双向同步服务 v2.4

修复：双向同步时的循环创建问题
使用统一的双向映射表，确保 WebUI ID ↔ Notion ID 一对一

同步模式：
- webui_to_notion   : WebUI → Notion（新增/修改/删除）
- notion_to_webui   : Notion → WebUI（新增/修改/删除）
- bidirectional     : 双向同步（使用统一映射，避免循环）
"""
import os
import sys
import time
import yaml
import json
import hashlib
import sqlite3
import requests
import re
import uuid
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify
import chromadb
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_DIR = Path("/app") if Path("/app").exists() else Path.home() / "ai-system"
DATA_DIR = BASE_DIR / "data"
CONFIG_PATH = BASE_DIR / "config/notion.yaml"
SYNC_STATE_PATH = DATA_DIR / "sync_state.json"
CHROMA_PATH = DATA_DIR / "vector-db"
WEBUI_DB_PATH = "/webui-data/webui.db"

NOTION_API = "https://api.notion.com/v1"

app = Flask(__name__)

# ==================== 工具函数 ====================

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def format_uuid(raw_id):
    clean_id = raw_id.replace('-', '')
    if len(clean_id) == 32:
        return f"{clean_id[:8]}-{clean_id[8:12]}-{clean_id[12:16]}-{clean_id[16:20]}-{clean_id[20:]}"
    return raw_id

def content_hash(text):
    return hashlib.md5(text.encode()).hexdigest()[:16]

def parse_title_category(title):
    """【分类】标题 → (分类, 标题)"""
    match = re.match(r'【(.+?)】(.+)', title)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return None, title

def format_title_with_category(title, category):
    """标题 + 分类 → 【分类】标题"""
    if category:
        return f"【{category}】{title}"
    return title

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
    return {
        "last_sync": None,
        # 统一的双向映射表：webui_id ↔ notion_id
        # 格式: { webui_id: { notion_id, webui_hash, notion_timestamp, title } }
        "note_mapping": {},
        # 反向索引：notion_id → webui_id（快速查找）
        "notion_to_webui_index": {},
        # 向量库相关
        "page_timestamps": {},
        "summary_done": []
    }

def save_state(state):
    # 重建反向索引
    state["notion_to_webui_index"] = {}
    for webui_id, info in state.get("note_mapping", {}).items():
        notion_id = info.get("notion_id")
        if notion_id:
            state["notion_to_webui_index"][notion_id] = webui_id
    
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
        
        self.session = requests.Session()
        retry = Retry(total=3, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount('https://', adapter)
        
        self.chroma = chromadb.PersistentClient(path=str(CHROMA_PATH))
        self.collection = self.chroma.get_or_create_collection("notion")
        self.ai_model = config.get('ai', {}).get('model', 'qwen2.5:14b-instruct')
        self.ollama_url = "http://host.docker.internal:11434"
        self.flow = config.get('notes', {}).get('flow', 'webui_to_notion')
        
        self.auto_summary = config.get('review', {}).get('auto_summary', False)
        self.auto_title = config.get('review', {}).get('auto_title', False)

    # ==================== Notion API ====================

    def api_request(self, method, url, **kwargs):
        kwargs['headers'] = self.headers
        kwargs['timeout'] = 30
        try:
            if method == 'GET':
                return self.session.get(url, **kwargs)
            elif method == 'POST':
                return self.session.post(url, **kwargs)
            elif method == 'PATCH':
                return self.session.patch(url, **kwargs)
            elif method == 'DELETE':
                return self.session.delete(url, **kwargs)
        except Exception as e:
            log(f"    ⚠️ API 请求失败: {e}")
            return None

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
            
            response = self.api_request('POST', url, json=payload)
            if not response or response.status_code != 200:
                break
                
            data = response.json()
            all_pages.extend(data.get('results', []))
            has_more = data.get('has_more', False)
            start_cursor = data.get('next_cursor')
            
        return all_pages

    def get_page_content(self, page_id):
        url = f"{NOTION_API}/blocks/{page_id}/children"
        response = self.api_request('GET', url)
        if not response or response.status_code != 200:
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

    def get_page_title(self, page):
        props = page.get('properties', {})
        for key, value in props.items():
            if value.get('type') == 'title':
                title_arr = value.get('title', [])
                if title_arr:
                    return title_arr[0].get('plain_text', '')
        return ''

    def get_page_category(self, page):
        props = page.get('properties', {})
        if '分类' in props:
            select = props['分类'].get('select')
            if select:
                return select.get('name', '')
        return ''

    def get_page_last_edited(self, page):
        return page.get('last_edited_time', '')

    def create_notion_page(self, db_id, title, content, category=None):
        formatted_id = format_uuid(db_id)
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

        properties = {"名称": {"title": [{"text": {"content": title}}]}}
        if category:
            properties["分类"] = {"select": {"name": category}}

        payload = {
            "parent": {"database_id": formatted_id},
            "properties": properties,
            "children": blocks[:100]
        }

        response = self.api_request('POST', f"{NOTION_API}/pages", json=payload)
        if response and response.status_code == 200:
            return response.json().get('id')
        return None

    def update_notion_page(self, page_id, title, content, category=None):
        # 更新属性
        url = f"{NOTION_API}/pages/{page_id}"
        properties = {"名称": {"title": [{"text": {"content": title}}]}}
        if category:
            properties["分类"] = {"select": {"name": category}}
        
        response = self.api_request('PATCH', url, json={"properties": properties})
        if not response or response.status_code != 200:
            return False
        
        # 删除旧 blocks
        blocks_url = f"{NOTION_API}/blocks/{page_id}/children"
        blocks_response = self.api_request('GET', blocks_url)
        if blocks_response and blocks_response.status_code == 200:
            for block in blocks_response.json().get('results', []):
                self.api_request('DELETE', f"{NOTION_API}/blocks/{block['id']}")
        
        # 添加新 blocks
        new_blocks = []
        for i in range(0, len(content), 2000):
            chunk = content[i:i+2000]
            new_blocks.append({
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": chunk}}]
                }
            })
        
        if new_blocks:
            self.api_request('PATCH', blocks_url, json={"children": new_blocks[:100]})
        
        return True

    def archive_notion_page(self, page_id):
        url = f"{NOTION_API}/pages/{page_id}"
        response = self.api_request('PATCH', url, json={"archived": True})
        return response and response.status_code == 200

    # ==================== WebUI Notes ====================

    def get_webui_notes(self):
        if not os.path.exists(WEBUI_DB_PATH):
            return []
        try:
            conn = sqlite3.connect(WEBUI_DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id, user_id, title, data, created_at, updated_at FROM note")
            rows = cursor.fetchall()
            conn.close()

            notes = []
            for row in rows:
                note_id, user_id, title, data_json, created_at, updated_at = row
                content = ""
                try:
                    data = json.loads(data_json) if isinstance(data_json, str) else data_json
                    content = data.get('content', {}).get('md', '') if isinstance(data, dict) else ''
                except:
                    pass
                notes.append({
                    "id": note_id,
                    "user_id": user_id,
                    "title": title or "",
                    "content": content,
                    "updated_at": updated_at
                })
            return notes
        except Exception as e:
            log(f"    ❌ 读取 WebUI 笔记失败: {e}")
            return []

    def create_webui_note(self, user_id, title, content):
        if not os.path.exists(WEBUI_DB_PATH):
            return None
        try:
            note_id = str(uuid.uuid4())
            now = int(time.time() * 1_000_000_000)
            data = json.dumps({"content": {"md": content}})
            
            conn = sqlite3.connect(WEBUI_DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO note (id, user_id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (note_id, user_id, title, data, now, now)
            )
            conn.commit()
            conn.close()
            return note_id
        except Exception as e:
            log(f"    ❌ 创建 WebUI 笔记失败: {e}")
            return None

    def update_webui_note(self, note_id, title, content):
        if not os.path.exists(WEBUI_DB_PATH):
            return False
        try:
            now = int(time.time() * 1_000_000_000)
            data = json.dumps({"content": {"md": content}})
            
            conn = sqlite3.connect(WEBUI_DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE note SET title = ?, data = ?, updated_at = ? WHERE id = ?",
                (title, data, now, note_id)
            )
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            log(f"    ❌ 更新 WebUI 笔记失败: {e}")
            return False

    def delete_webui_note(self, note_id):
        if not os.path.exists(WEBUI_DB_PATH):
            return False
        try:
            conn = sqlite3.connect(WEBUI_DB_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM note WHERE id = ?", (note_id,))
            conn.commit()
            conn.close()
            return True
        except:
            return False

    def get_webui_default_user_id(self):
        if not os.path.exists(WEBUI_DB_PATH):
            return None
        try:
            conn = sqlite3.connect(WEBUI_DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM user LIMIT 1")
            row = cursor.fetchone()
            conn.close()
            return row[0] if row else None
        except:
            return None

    # ==================== 同步逻辑 ====================

    def sync_notes_bidirectional(self):
        """双向同步笔记（使用统一映射表）"""
        log("  🔄 双向同步笔记")

        ai_notes_id = self.config['notion']['databases'].get('AI笔记')
        if not ai_notes_id:
            log("    ⚠️ AI笔记数据库未配置")
            return 0

        state = load_state()
        mapping = state.get('note_mapping', {})
        notion_index = state.get('notion_to_webui_index', {})

        # 获取两边的数据
        webui_notes = {n['id']: n for n in self.get_webui_notes()}
        notion_pages_list = self.query_database_all(ai_notes_id)
        notion_pages = {p['id']: p for p in notion_pages_list}
        
        default_user_id = self.get_webui_default_user_id()

        log(f"    WebUI: {len(webui_notes)} 条, Notion: {len(notion_pages)} 条")

        created_to_notion = 0
        created_to_webui = 0
        updated = 0
        deleted_from_notion = 0
        deleted_from_webui = 0
        skipped = 0

        # 1. 处理已映射的笔记（检测更新和删除）
        for webui_id in list(mapping.keys()):
            info = mapping[webui_id]
            notion_id = info.get('notion_id')
            
            webui_exists = webui_id in webui_notes
            notion_exists = notion_id in notion_pages if notion_id else False
            
            # 两边都删了，清理映射
            if not webui_exists and not notion_exists:
                del mapping[webui_id]
                continue
            
            # WebUI 删了，删除 Notion
            if not webui_exists and notion_exists:
                if self.archive_notion_page(notion_id):
                    log(f"    🗑️ Notion: {info.get('title', 'Unknown')}")
                    deleted_from_notion += 1
                del mapping[webui_id]
                continue
            
            # Notion 删了，删除 WebUI
            if webui_exists and not notion_exists:
                if self.delete_webui_note(webui_id):
                    log(f"    🗑️ WebUI: {info.get('title', 'Unknown')}")
                    deleted_from_webui += 1
                del mapping[webui_id]
                continue
            
            # 两边都存在，检测更新
            webui_note = webui_notes[webui_id]
            notion_page = notion_pages[notion_id]
            
            # 计算当前状态
            webui_hash = content_hash(webui_note['title'] + webui_note['content'])
            notion_timestamp = self.get_page_last_edited(notion_page)
            
            # 获取上次同步时的状态
            old_hash = info.get('webui_hash')
            old_timestamp = info.get('notion_timestamp')
            
            # 判断是否有变化
            webui_changed = (old_hash != webui_hash)
            notion_changed = (old_timestamp != notion_timestamp)
            
            # 两边都没变，跳过
            if not webui_changed and not notion_changed:
                skipped += 1
                continue
            
            # 只有 Notion timestamp 变了，但需要检查内容是否真的变了
            if notion_changed and not webui_changed:
                # 获取 Notion 当前内容
                raw_title = self.get_page_title(notion_page)
                category = self.get_page_category(notion_page)
                webui_title = format_title_with_category(raw_title, category)
                content = self.get_page_content(notion_id)
                
                if not content:
                    # 更新 timestamp 避免下次再检查
                    mapping[webui_id]['notion_timestamp'] = notion_timestamp
                    skipped += 1
                    continue
                
                # 检查 Notion 内容是否和 WebUI 当前内容一样
                notion_hash = content_hash(webui_title + content)
                if notion_hash == webui_hash:
                    # 内容一样，只是 timestamp 变了（可能是 Notion 内部更新）
                    mapping[webui_id]['notion_timestamp'] = notion_timestamp
                    skipped += 1
                    continue
                
                # 内容真的变了，更新到 WebUI
                if self.update_webui_note(webui_id, webui_title, content):
                    mapping[webui_id] = {
                        'notion_id': notion_id,
                        'webui_hash': notion_hash,
                        'notion_timestamp': notion_timestamp,
                        'title': webui_title
                    }
                    log(f"    ✏️ → WebUI: {webui_title}")
                    updated += 1
                continue
            
            # WebUI 变了，Notion 没变，更新到 Notion
            if webui_changed and not notion_changed:
                category, title = parse_title_category(webui_note['title'])
                if self.update_notion_page(notion_id, title, webui_note['content'], category):
                    # 更新后重新获取 Notion 的 timestamp
                    new_page = self.api_request('GET', f"{NOTION_API}/pages/{notion_id}")
                    new_timestamp = new_page.json().get('last_edited_time', '') if new_page else notion_timestamp
                    mapping[webui_id] = {
                        'notion_id': notion_id,
                        'webui_hash': webui_hash,
                        'notion_timestamp': new_timestamp,
                        'title': webui_note['title']
                    }
                    log(f"    ✏️ → Notion: {title}")
                    updated += 1
                continue
            
            # 两边都变了，比较更新时间决定以谁为准
            if webui_changed and notion_changed:
                # 获取 Notion 内容
                raw_title = self.get_page_title(notion_page)
                category = self.get_page_category(notion_page)
                webui_title = format_title_with_category(raw_title, category)
                notion_content = self.get_page_content(notion_id)
                
                if not notion_content:
                    skipped += 1
                    continue
                
                # 检查内容是否实际相同
                notion_hash = content_hash(webui_title + notion_content)
                if notion_hash == webui_hash:
                    # 内容一样，不需要同步
                    mapping[webui_id] = {
                        'notion_id': notion_id,
                        'webui_hash': webui_hash,
                        'notion_timestamp': notion_timestamp,
                        'title': webui_note['title']
                    }
                    skipped += 1
                    continue
                
                # 内容不同，比较更新时间
                from datetime import datetime as dt, timezone
                try:
                    notion_time = dt.fromisoformat(notion_timestamp.replace('Z', '+00:00'))
                    # 转为无时区的 UTC 时间进行比较
                    notion_time = notion_time.replace(tzinfo=None)
                except:
                    notion_time = dt.min
                
                try:
                    webui_time = dt.fromtimestamp(webui_note['updated_at'] / 1_000_000_000)
                except:
                    webui_time = dt.min
                
                if webui_time > notion_time:
                    # WebUI 更新，同步到 Notion
                    category, title = parse_title_category(webui_note['title'])
                    if self.update_notion_page(notion_id, title, webui_note['content'], category):
                        new_page = self.api_request('GET', f"{NOTION_API}/pages/{notion_id}")
                        new_timestamp = new_page.json().get('last_edited_time', '') if new_page else notion_timestamp
                        mapping[webui_id] = {
                            'notion_id': notion_id,
                            'webui_hash': webui_hash,
                            'notion_timestamp': new_timestamp,
                            'title': webui_note['title']
                        }
                        log(f"    ⚠️ 冲突，WebUI 较新 → Notion: {title}")
                        updated += 1
                else:
                    # Notion 更新，同步到 WebUI
                    if self.update_webui_note(webui_id, webui_title, notion_content):
                        mapping[webui_id] = {
                            'notion_id': notion_id,
                            'webui_hash': notion_hash,
                            'notion_timestamp': notion_timestamp,
                            'title': webui_title
                        }
                        log(f"    ⚠️ 冲突，Notion 较新 → WebUI: {webui_title}")
                        updated += 1

        # 2. 处理 WebUI 中新增的笔记
        for webui_id, note in webui_notes.items():
            if webui_id in mapping:
                continue
            if not note['content']:
                continue
            
            category, title = parse_title_category(note['title'])
            notion_id = self.create_notion_page(ai_notes_id, title, note['content'], category)
            if notion_id:
                mapping[webui_id] = {
                    'notion_id': notion_id,
                    'webui_hash': content_hash(note['title'] + note['content']),
                    'notion_timestamp': datetime.now().isoformat(),
                    'title': note['title']
                }
                log(f"    ✓ → Notion: {note['title']}")
                created_to_notion += 1

        # 3. 处理 Notion 中新增的笔记
        # 重建反向索引
        notion_index = {info['notion_id']: wid for wid, info in mapping.items() if info.get('notion_id')}
        
        for notion_id, page in notion_pages.items():
            if notion_id in notion_index:
                continue
            
            raw_title = self.get_page_title(page)
            category = self.get_page_category(page)
            webui_title = format_title_with_category(raw_title, category)
            content = self.get_page_content(notion_id)
            
            if not content:
                continue
            
            webui_id = self.create_webui_note(default_user_id, webui_title, content)
            if webui_id:
                mapping[webui_id] = {
                    'notion_id': notion_id,
                    'webui_hash': content_hash(webui_title + content),
                    'notion_timestamp': self.get_page_last_edited(page),
                    'title': webui_title
                }
                log(f"    ✓ → WebUI: {webui_title}")
                created_to_webui += 1

        state['note_mapping'] = mapping
        save_state(state)

        # 统计
        stats = []
        if created_to_notion > 0:
            stats.append(f"→Notion {created_to_notion}")
        if created_to_webui > 0:
            stats.append(f"→WebUI {created_to_webui}")
        if updated > 0:
            stats.append(f"更新 {updated}")
        if deleted_from_notion > 0:
            stats.append(f"删Notion {deleted_from_notion}")
        if deleted_from_webui > 0:
            stats.append(f"删WebUI {deleted_from_webui}")
        if skipped > 0:
            stats.append(f"跳过 {skipped}")
        
        log(f"    ✅ {', '.join(stats) if stats else '无变化'}")
        return created_to_notion + created_to_webui + updated

    def sync_webui_to_notion_only(self):
        """单向同步：WebUI → Notion"""
        log("  📤 WebUI → Notion")
        
        ai_notes_id = self.config['notion']['databases'].get('AI笔记')
        if not ai_notes_id:
            return 0

        state = load_state()
        mapping = state.get('note_mapping', {})
        
        webui_notes = {n['id']: n for n in self.get_webui_notes()}
        
        created = 0
        updated = 0
        deleted = 0
        skipped = 0

        # 检测删除
        for webui_id in list(mapping.keys()):
            if webui_id not in webui_notes:
                info = mapping[webui_id]
                notion_id = info.get('notion_id')
                if notion_id and self.archive_notion_page(notion_id):
                    log(f"    🗑️ {info.get('title', 'Unknown')}")
                    deleted += 1
                del mapping[webui_id]

        # 检测新增和修改
        for webui_id, note in webui_notes.items():
            if not note['content']:
                continue
                
            current_hash = content_hash(note['title'] + note['content'])
            category, title = parse_title_category(note['title'])
            
            if webui_id in mapping:
                info = mapping[webui_id]
                if info.get('webui_hash') == current_hash:
                    skipped += 1
                    continue
                
                notion_id = info.get('notion_id')
                if notion_id and self.update_notion_page(notion_id, title, note['content'], category):
                    mapping[webui_id]['webui_hash'] = current_hash
                    mapping[webui_id]['title'] = note['title']
                    log(f"    ✏️ {title}")
                    updated += 1
            else:
                notion_id = self.create_notion_page(ai_notes_id, title, note['content'], category)
                if notion_id:
                    mapping[webui_id] = {
                        'notion_id': notion_id,
                        'webui_hash': current_hash,
                        'title': note['title']
                    }
                    log(f"    ✓ {note['title']}")
                    created += 1

        state['note_mapping'] = mapping
        save_state(state)
        
        stats = []
        if created > 0: stats.append(f"新建 {created}")
        if updated > 0: stats.append(f"更新 {updated}")
        if deleted > 0: stats.append(f"删除 {deleted}")
        if skipped > 0: stats.append(f"跳过 {skipped}")
        log(f"    ✅ {', '.join(stats) if stats else '无变化'}")
        
        return created + updated

    def sync_notion_to_webui_only(self):
        """单向同步：Notion → WebUI"""
        log("  📥 Notion → WebUI")
        
        ai_notes_id = self.config['notion']['databases'].get('AI笔记')
        if not ai_notes_id or not os.path.exists(WEBUI_DB_PATH):
            return 0

        state = load_state()
        mapping = state.get('note_mapping', {})
        notion_index = {info['notion_id']: wid for wid, info in mapping.items() if info.get('notion_id')}
        
        notion_pages = {p['id']: p for p in self.query_database_all(ai_notes_id)}
        default_user_id = self.get_webui_default_user_id()
        
        created = 0
        updated = 0
        deleted = 0
        skipped = 0

        # 检测删除
        for webui_id in list(mapping.keys()):
            info = mapping[webui_id]
            notion_id = info.get('notion_id')
            if notion_id and notion_id not in notion_pages:
                if self.delete_webui_note(webui_id):
                    log(f"    🗑️ {info.get('title', 'Unknown')}")
                    deleted += 1
                del mapping[webui_id]

        # 检测新增和修改
        for notion_id, page in notion_pages.items():
            raw_title = self.get_page_title(page)
            category = self.get_page_category(page)
            webui_title = format_title_with_category(raw_title, category)
            timestamp = self.get_page_last_edited(page)
            
            if notion_id in notion_index:
                webui_id = notion_index[notion_id]
                info = mapping.get(webui_id, {})
                
                if info.get('notion_timestamp') == timestamp:
                    skipped += 1
                    continue
                
                content = self.get_page_content(notion_id)
                if content and self.update_webui_note(webui_id, webui_title, content):
                    mapping[webui_id]['notion_timestamp'] = timestamp
                    mapping[webui_id]['title'] = webui_title
                    log(f"    ✏️ {webui_title}")
                    updated += 1
            else:
                content = self.get_page_content(notion_id)
                if not content:
                    continue
                    
                webui_id = self.create_webui_note(default_user_id, webui_title, content)
                if webui_id:
                    mapping[webui_id] = {
                        'notion_id': notion_id,
                        'notion_timestamp': timestamp,
                        'title': webui_title
                    }
                    log(f"    ✓ {webui_title}")
                    created += 1

        state['note_mapping'] = mapping
        save_state(state)
        
        stats = []
        if created > 0: stats.append(f"新建 {created}")
        if updated > 0: stats.append(f"更新 {updated}")
        if deleted > 0: stats.append(f"删除 {deleted}")
        if skipped > 0: stats.append(f"跳过 {skipped}")
        log(f"    ✅ {', '.join(stats) if stats else '无变化'}")
        
        return created + updated

    def sync_database_to_vector(self, db_name, db_id, with_summary=False):
        """同步 Notion 数据库到向量库"""
        log(f"  📚 {db_name} → 向量库")
        pages = self.query_database_all(db_id)
        total = len(pages)
        log(f"    找到 {total} 个页面")

        if total == 0:
            return 0

        state = load_state()
        page_timestamps = state.get('page_timestamps', {})
        summary_done = state.get('summary_done', [])

        pages_to_sync = [(p, self.get_page_last_edited(p)) for p in pages 
                         if page_timestamps.get(p['id']) != self.get_page_last_edited(p)]

        if not pages_to_sync:
            log(f"    ✅ 无更新，跳过 {total}")
            return 0

        log(f"    需要同步: {len(pages_to_sync)}, 跳过: {total - len(pages_to_sync)}")

        synced = 0
        for i, (page, last_edited) in enumerate(pages_to_sync):
            page_id = page['id']
            title = self.get_page_title(page)
            
            if (i + 1) % 10 == 0 or (i + 1) == len(pages_to_sync):
                log(f"    同步中: {i + 1}/{len(pages_to_sync)}")
            
            content = self.get_page_content(page_id)
            if not content:
                page_timestamps[page_id] = last_edited
                continue

            doc_id = f"notion_{page_id.replace('-', '')}"
            self.collection.upsert(
                ids=[doc_id],
                documents=[content],
                metadatas=[{
                    "title": title or "无标题",
                    "source": "notion",
                    "database": db_name,
                    "page_id": page_id,
                    "updated_at": datetime.now().isoformat()
                }]
            )
            
            page_timestamps[page_id] = last_edited
            synced += 1

        state['page_timestamps'] = page_timestamps
        state['summary_done'] = summary_done
        save_state(state)

        log(f"    ✅ 同步 {synced}")
        return synced

    def sync_all(self):
        log("🔄 开始同步...")
        flow_desc = {
            'bidirectional': '双向同步',
            'notion_to_webui': 'Notion → WebUI',
            'webui_to_notion': 'WebUI → Notion'
        }
        log(f"  📋 模式: {flow_desc.get(self.flow, self.flow)}")
        
        results = {'notes': 0, 'vector': 0}

        # 笔记同步
        if self.flow == 'bidirectional':
            results['notes'] = self.sync_notes_bidirectional()
        elif self.flow == 'webui_to_notion':
            results['notes'] = self.sync_webui_to_notion_only()
        elif self.flow == 'notion_to_webui':
            results['notes'] = self.sync_notion_to_webui_only()

        # 向量库同步
        log("  📊 Notion → 向量库")
        for db_name, db_id in self.config['notion'].get('databases', {}).items():
            results['vector'] += self.sync_database_to_vector(db_name, db_id, db_name == '复盘')

        state = load_state()
        state['last_sync'] = datetime.now().isoformat()
        save_state(state)

        log("=" * 50)
        log("✅ 同步完成!")
        log(f"  📝 笔记: {results['notes']} 条")
        log(f"  📊 向量库: {results['vector']} 页")
        log(f"  📁 总计: {self.collection.count()} 条")
        
        return results['notes'] + results['vector']

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
                        "database": meta.get('database', ''),
                    })
            return items
        except:
            return []


# ==================== Flask API ====================

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
    return jsonify({"status": "ok", "version": "2.4"})

@app.route('/sync', methods=['POST'])
def do_sync():
    s = get_syncer()
    if not s:
        return jsonify({"error": "配置不存在"}), 500
    return jsonify({"success": True, "synced": s.sync_all()})

@app.route('/search', methods=['POST'])
def do_search():
    s = get_syncer()
    if not s:
        return jsonify({"error": "配置不存在"}), 500
    data = request.json or {}
    return jsonify({"results": s.search(data.get('query', ''), data.get('limit', 5))})

@app.route('/status')
def status():
    state = load_state()
    config = load_config()
    s = get_syncer()
    return jsonify({
        "last_sync": state.get('last_sync'),
        "documents": s.collection.count() if s else 0,
        "flow": config.get('notes', {}).get('flow') if config else None
    })


if __name__ == '__main__':
    log("🚀 启动同步服务 v2.4...")
    config = load_config()
    if config:
        log(f"📄 数据库: {list(config['notion']['databases'].keys())}")
        flow = config.get('notes', {}).get('flow', 'webui_to_notion')
        log(f"🔄 模式: {flow}")
        
        try:
            s = get_syncer()
            if s:
                s.sync_all()
        except Exception as e:
            log(f"❌ 初始同步失败: {e}")
            import traceback
            traceback.print_exc()

    app.run(host='0.0.0.0', port=5100, debug=False)
