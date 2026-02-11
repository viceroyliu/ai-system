#!/usr/bin/env python3
"""
Telegram 消息管理 - 带连接状态
"""
import os
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_file, render_template_string

DATA_PATH = Path("/app/data") if Path("/app/data").exists() else Path.home() / "ai-system/data"
DB_PATH = DATA_PATH / "telegram.db"
IMAGES_PATH = DATA_PATH / "telegram_images"
SETTINGS_PATH = DATA_PATH / "tg_settings.json"
STATUS_PATH = DATA_PATH / "tg_status.json"

app = Flask(__name__)

def load_settings():
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH, 'r') as f:
            return json.load(f)
    return {'theme': 'dark', 'channel_order': []}

def save_settings(settings):
    with open(SETTINGS_PATH, 'w') as f:
        json.dump(settings, f)

def get_status():
    if STATUS_PATH.exists():
        with open(STATUS_PATH, 'r') as f:
            return json.load(f)
    return {'connected': False, 'error': 'unknown'}

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>工作消息中心</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --bg-hover: #30363d;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --accent: #58a6ff;
            --accent-hover: #79b8ff;
            --border: #30363d;
            --success: #3fb950;
            --warning: #d29922;
            --danger: #f85149;
        }
        
        [data-theme="light"] {
            --bg-primary: #ffffff;
            --bg-secondary: #f6f8fa;
            --bg-tertiary: #eaeef2;
            --bg-hover: #d8dee4;
            --text-primary: #24292f;
            --text-secondary: #57606a;
            --accent: #0969da;
            --accent-hover: #0550ae;
            --border: #d0d7de;
        }
        
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg-primary); color: var(--text-primary); height: 100vh; overflow: hidden; }
        .layout { display: flex; height: 100vh; }
        
        .sidebar { width: 300px; background: var(--bg-secondary); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .sidebar-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .sidebar-header h2 { font-size: 14px; font-weight: 600; }
        
        .req-list { flex: 1; overflow-y: auto; }
        .req-item { padding: 12px 20px; border-bottom: 1px solid var(--border); cursor: pointer; }
        .req-item:hover { background: var(--bg-hover); }
        .req-title { font-size: 14px; font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .req-meta { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; }
        .req-status { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
        .status-pending { background: var(--warning); color: #000; }
        .status-done { background: var(--success); color: #000; }
        
        .add-req-btn { margin: 12px 16px; padding: 10px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
        .add-req-btn:hover { background: var(--accent-hover); }
        
        .main { flex: 1; display: flex; flex-direction: column; }
        
        .topbar { padding: 12px 20px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 16px; }
        .search-box { display: flex; flex: 1; max-width: 500px; }
        .search-input { flex: 1; padding: 8px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px 0 0 6px; color: var(--text-primary); font-size: 14px; }
        .search-input:focus { outline: none; border-color: var(--accent); }
        .search-btn { padding: 8px 16px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); border-left: none; border-radius: 0 6px 6px 0; cursor: pointer; }
        
        .topbar-right { display: flex; align-items: center; gap: 12px; }
        
        .connection-status { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 12px; font-size: 12px; }
        .connection-status.connected { background: rgba(63, 185, 80, 0.2); color: var(--success); }
        .connection-status.disconnected { background: rgba(248, 81, 73, 0.2); color: var(--danger); }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .status-dot.connected { background: var(--success); }
        .status-dot.disconnected { background: var(--danger); animation: blink 1s infinite; }
        @keyframes blink { 50% { opacity: 0.3; } }
        
        .icon-btn { background: none; border: none; color: var(--text-secondary); font-size: 18px; cursor: pointer; padding: 6px; border-radius: 6px; }
        .icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        
        .theme-toggle { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
        .theme-btn { padding: 6px 10px; background: var(--bg-tertiary); border: none; color: var(--text-secondary); cursor: pointer; font-size: 12px; }
        .theme-btn:first-child { border-right: 1px solid var(--border); }
        .theme-btn.active { background: var(--accent); color: #fff; }
        
        .channel-tabs { padding: 8px 20px; background: var(--bg-secondary); display: flex; gap: 6px; flex-wrap: nowrap; overflow-x: auto; border-bottom: 1px solid var(--border); }
        .channel-tabs::-webkit-scrollbar { height: 0; }
        .channel-tab { padding: 6px 12px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 20px; font-size: 12px; cursor: pointer; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
        .channel-tab:hover { border-color: var(--accent); }
        .channel-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
        .msg-count { background: var(--danger); color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 10px; }
        .channel-tab.active .msg-count { background: rgba(255,255,255,0.3); }
        
        .messages { flex: 1; overflow-y: auto; padding: 16px 20px; }
        .message { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }
        .message-header { display: flex; justify-content: space-between; margin-bottom: 8px; align-items: center; }
        .message-meta { display: flex; align-items: center; gap: 8px; }
        .message-channel { font-size: 11px; color: var(--accent); background: var(--bg-tertiary); padding: 2px 8px; border-radius: 4px; }
        .message-sender { font-weight: 600; font-size: 14px; }
        .message-time { font-size: 12px; color: var(--text-secondary); }
        .message-content { color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap; font-size: 14px; }
        .message-image { margin-top: 12px; max-width: 400px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border); }
        
        .empty { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
        .empty-icon { font-size: 48px; margin-bottom: 16px; }
        
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); justify-content: center; align-items: center; z-index: 1000; }
        .modal.active { display: flex; }
        .modal-content { background: var(--bg-secondary); border: 1px solid var(--border); padding: 24px; border-radius: 12px; width: 480px; max-width: 90%; max-height: 80vh; overflow-y: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .modal-header h3 { font-size: 16px; font-weight: 600; }
        .modal-close { background: none; border: none; color: var(--text-secondary); font-size: 20px; cursor: pointer; }
        
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary); font-weight: 500; }
        .form-group input, .form-group textarea { width: 100%; padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 14px; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--accent); }
        .form-group textarea { height: 120px; resize: vertical; font-family: inherit; }
        
        .btn { padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
        .btn-primary { background: var(--accent); color: #fff; }
        .btn-danger { background: var(--danger); color: #fff; }
        .btn-block { width: 100%; }
        
        .channel-list { max-height: 250px; overflow-y: auto; }
        .channel-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; }
        .channel-name { font-size: 13px; flex: 1; }
        .channel-toggle { padding: 4px 10px; font-size: 12px; margin-left: 10px; }
        .drag-handle { color: var(--text-secondary); margin-right: 10px; cursor: grab; }
        
        .search-results { max-height: 200px; overflow-y: auto; margin-bottom: 16px; }
        .search-result-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 4px; }
        
        .refresh-btn { background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px; }
        .refresh-btn:hover { background: var(--bg-hover); }
        
        .image-preview { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); justify-content: center; align-items: center; z-index: 1001; cursor: pointer; }
        .image-preview.active { display: flex; }
        .image-preview img { max-width: 90%; max-height: 90%; }
    </style>
</head>
<body data-theme="dark">
    <div class="layout">
        <div class="sidebar">
            <div class="sidebar-header">
                <h2>📋 需求列表</h2>
            </div>
            <div class="req-list" id="req-list"></div>
            <button class="add-req-btn" onclick="showAddReq()">+ 新建需求</button>
        </div>
        
        <div class="main">
            <div class="topbar">
                <div class="search-box">
                    <input type="text" class="search-input" id="search-input" placeholder="搜索消息..." onkeypress="if(event.key==='Enter')search()">
                    <button class="search-btn" onclick="search()">搜索</button>
                </div>
                <div class="topbar-right">
                    <div class="connection-status disconnected" id="conn-status">
                        <span class="status-dot disconnected"></span>
                        <span>连接中...</span>
                    </div>
                    <div class="theme-toggle">
                        <button class="theme-btn active" onclick="setTheme('dark')">🌙</button>
                        <button class="theme-btn" onclick="setTheme('light')">☀️</button>
                    </div>
                    <button class="icon-btn" onclick="showSettings()" title="频道管理">⚙️</button>
                </div>
            </div>
            
            <div class="channel-tabs" id="channel-tabs"></div>
            <div class="messages" id="messages"></div>
        </div>
    </div>
    
    <div class="modal" id="settings-modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>⚙️ 频道管理</h3>
                <button class="modal-close" onclick="hideModal('settings-modal')">&times;</button>
            </div>
            <div class="form-group">
                <label>搜索频道 <button class="refresh-btn" onclick="refreshChannelList()">🔄 刷新</button></label>
                <input type="text" id="channel-search" placeholder="输入名称搜索..." oninput="filterChannels(this.value)">
            </div>
            <div class="search-results" id="search-results"></div>
            <div class="form-group"><label>已监听（可拖动排序）</label></div>
            <div class="channel-list" id="active-channels"></div>
        </div>
    </div>
    
    <div class="modal" id="req-modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>📝 新建需求</h3>
                <button class="modal-close" onclick="hideModal('req-modal')">&times;</button>
            </div>
            <div class="form-group"><label>标题</label><input type="text" id="req-title" placeholder="需求标题"></div>
            <div class="form-group"><label>内容</label><textarea id="req-content" placeholder="需求描述..."></textarea></div>
            <button class="btn btn-primary btn-block" onclick="addReq()">创建</button>
        </div>
    </div>
    
    <div class="image-preview" id="image-preview" onclick="this.classList.remove('active')">
        <img id="preview-img" src="">
    </div>
    
    <script>
        let currentChannel = null;
        let allChannels = [];
        let settings = { theme: 'dark', channel_order: [] };
        
        async function init() {
            await loadSettings();
            setTheme(settings.theme, false);
            await loadAllChannels();
            loadReqs();
            loadChannelTabs();
            loadMessages();
            checkStatus();
            setInterval(() => loadMessages(currentChannel), 15000);
            setInterval(checkStatus, 5000);
        }
        
        async function checkStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                const el = document.getElementById('conn-status');
                if (data.connected) {
                    el.className = 'connection-status connected';
                    el.innerHTML = '<span class="status-dot connected"></span><span>已连接</span>';
                } else {
                    el.className = 'connection-status disconnected';
                    el.innerHTML = '<span class="status-dot disconnected"></span><span>断开连接</span>';
                }
            } catch(e) {
                const el = document.getElementById('conn-status');
                el.className = 'connection-status disconnected';
                el.innerHTML = '<span class="status-dot disconnected"></span><span>服务异常</span>';
            }
        }
        
        async function loadSettings() {
            try { const res = await fetch('/api/settings'); settings = await res.json(); } catch(e) {}
        }
        
        async function saveSettings() {
            await fetch('/api/settings', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(settings) });
        }
        
        function setTheme(theme, save = true) {
            document.body.setAttribute('data-theme', theme);
            document.querySelectorAll('.theme-btn').forEach((b, i) => b.classList.toggle('active', (theme === 'dark' && i === 0) || (theme === 'light' && i === 1)));
            settings.theme = theme;
            if (save) saveSettings();
        }
        
        async function loadAllChannels() {
            const res = await fetch('/api/channels');
            allChannels = (await res.json()).channels;
        }
        
        async function refreshChannelList() {
            const btn = event.target;
            btn.textContent = '⏳...';
            btn.disabled = true;
            try {
                await fetch('/api/refresh_channels', { method: 'POST' });
                await loadAllChannels();
                filterChannels(document.getElementById('channel-search').value);
            } catch(e) { alert('刷新失败'); }
            btn.textContent = '🔄 刷新';
            btn.disabled = false;
        }
        
        async function loadReqs() {
            const res = await fetch('/api/requirements');
            const data = await res.json();
            const list = document.getElementById('req-list');
            if (data.requirements.length === 0) {
                list.innerHTML = '<div class="empty"><div class="empty-icon">📝</div>暂无需求</div>';
                return;
            }
            list.innerHTML = data.requirements.map(r => `
                <div class="req-item">
                    <div class="req-title">${r.title}</div>
                    <div class="req-meta"><span class="req-status status-${r.status}">${r.status === 'done' ? '完成' : '待处理'}</span><span>${r.created_at?.split('T')[0] || ''}</span></div>
                </div>
            `).join('');
        }
        
        async function loadChannelTabs() {
            const active = allChannels.filter(c => c.active);
            const tabs = document.getElementById('channel-tabs');
            if (active.length === 0) {
                tabs.innerHTML = '<span style="color:var(--text-secondary); padding: 8px;">点击 ⚙️ 添加监听频道</span>';
                return;
            }
            const ordered = [...active].sort((a, b) => {
                const ia = settings.channel_order.indexOf(a.id);
                const ib = settings.channel_order.indexOf(b.id);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
            const counts = await fetch('/api/channel_counts').then(r => r.json());
            tabs.innerHTML = '<div class="channel-tab active" onclick="filterChannel(null, this)">全部</div>' +
                ordered.map(c => {
                    const count = counts[c.id] || 0;
                    return `<div class="channel-tab" data-id="${c.id}" onclick="filterChannel(${c.id}, this)" draggable="true" ondragstart="dragStart(event)" ondragover="e=>e.preventDefault()" ondrop="drop(event)">${c.name}${count ? '<span class="msg-count">'+count+'</span>' : ''}</div>`;
                }).join('');
        }
        
        let draggedEl = null;
        function dragStart(e) { draggedEl = e.target; e.target.style.opacity = '0.5'; }
        function drop(e) {
            e.preventDefault();
            if (!draggedEl) return;
            draggedEl.style.opacity = '1';
            const target = e.target.closest('.channel-tab');
            if (!target || !target.dataset.id) return;
            const tabs = document.getElementById('channel-tabs');
            target.before(draggedEl);
            settings.channel_order = [...tabs.querySelectorAll('.channel-tab[data-id]')].map(el => parseInt(el.dataset.id));
            saveSettings();
        }
        
        async function loadMessages(channelId = null) {
            const query = document.getElementById('search-input').value;
            let url = '/api/messages?limit=100';
            if (query) url += '&q=' + encodeURIComponent(query);
            if (channelId) url += '&channel_id=' + channelId;
            const res = await fetch(url);
            const data = await res.json();
            const container = document.getElementById('messages');
            if (data.messages.length === 0) {
                container.innerHTML = '<div class="empty"><div class="empty-icon">💬</div>暂无消息</div>';
                return;
            }
            container.innerHTML = data.messages.map(m => `
                <div class="message">
                    <div class="message-header">
                        <div class="message-meta"><span class="message-channel">${m.channel_name || ''}</span><span class="message-sender">${m.sender_name || ''}</span></div>
                        <span class="message-time">${m.created_at || ''}</span>
                    </div>
                    <div class="message-content">${m.content || '(无文字)'}</div>
                    ${m.has_image ? '<img class="message-image" src="/api/image/' + m.id + '" onclick="previewImage(this.src)">' : ''}
                </div>
            `).join('');
        }
        
        function filterChannel(id, el) {
            currentChannel = id;
            document.querySelectorAll('.channel-tab').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
            loadMessages(id);
        }
        
        function search() { loadMessages(currentChannel); }
        
        async function showSettings() {
            await loadAllChannels();
            renderActiveChannels();
            document.getElementById('channel-search').value = '';
            document.getElementById('search-results').innerHTML = '';
            document.getElementById('settings-modal').classList.add('active');
        }
        
        function filterChannels(query) {
            const results = document.getElementById('search-results');
            if (!query) { results.innerHTML = ''; return; }
            const inactive = allChannels.filter(c => !c.active && c.name.toLowerCase().includes(query.toLowerCase()));
            if (inactive.length === 0) {
                results.innerHTML = '<div style="padding: 12px; color: var(--text-secondary); text-align: center;">未找到</div>';
                return;
            }
            results.innerHTML = inactive.slice(0, 10).map(c => `
                <div class="search-result-item"><span class="channel-name">${c.name}</span><button class="btn btn-primary channel-toggle" onclick="addChannel(${c.id})">添加</button></div>
            `).join('');
        }
        
        async function addChannel(id) {
            await fetch('/api/channels/' + id + '/toggle', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({active: true}) });
            await loadAllChannels();
            renderActiveChannels();
            loadChannelTabs();
            document.getElementById('channel-search').value = '';
            document.getElementById('search-results').innerHTML = '';
        }
        
        async function removeChannel(id) {
            await fetch('/api/channels/' + id + '/toggle', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({active: false}) });
            await loadAllChannels();
            renderActiveChannels();
            loadChannelTabs();
        }
        
        function renderActiveChannels() {
            const active = allChannels.filter(c => c.active);
            const list = document.getElementById('active-channels');
            if (active.length === 0) { list.innerHTML = '<div style="color:var(--text-secondary);text-align:center;padding:20px;">暂无</div>'; return; }
            const ordered = [...active].sort((a, b) => {
                const ia = settings.channel_order.indexOf(a.id);
                const ib = settings.channel_order.indexOf(b.id);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
            list.innerHTML = ordered.map(c => `
                <div class="channel-item"><span class="drag-handle">☰</span><span class="channel-name">${c.name}</span><button class="btn btn-danger channel-toggle" onclick="removeChannel(${c.id})">移除</button></div>
            `).join('');
        }
        
        function showAddReq() { document.getElementById('req-modal').classList.add('active'); }
        function hideModal(id) { document.getElementById(id).classList.remove('active'); }
        
        async function addReq() {
            const title = document.getElementById('req-title').value;
            const content = document.getElementById('req-content').value;
            if (!title) { alert('请填写标题'); return; }
            await fetch('/api/requirements', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title, content}) });
            document.getElementById('req-title').value = '';
            document.getElementById('req-content').value = '';
            hideModal('req-modal');
            loadReqs();
        }
        
        function previewImage(src) {
            document.getElementById('preview-img').src = src;
            document.getElementById('image-preview').classList.add('active');
        }
        
        init();
    </script>
</body>
</html>
'''

def get_db():
    return sqlite3.connect(str(DB_PATH))

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route('/api/status')
def api_status():
    return jsonify(get_status())

@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    if request.method == 'POST':
        save_settings(request.json)
        return jsonify({'success': True})
    return jsonify(load_settings())

@app.route('/api/refresh_channels', methods=['POST'])
def refresh_channels():
    try:
        import subprocess
        result = subprocess.run(['python3', '/app/telegram/tg_refresh.py'], capture_output=True, text=True, timeout=60)
        return jsonify({'success': True, 'output': result.stdout})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/messages')
def get_messages():
    query = request.args.get('q', '')
    channel_id = request.args.get('channel_id')
    limit = request.args.get('limit', 100)
    conn = get_db()
    cursor = conn.cursor()
    sql = 'SELECT m.id, m.channel_id, m.sender_name, m.content, m.has_image, m.created_at, c.name FROM messages m LEFT JOIN channels c ON m.channel_id = c.id WHERE 1=1'
    params = []
    if query:
        sql += ' AND m.content LIKE ?'
        params.append(f'%{query}%')
    if channel_id:
        sql += ' AND m.channel_id = ?'
        params.append(int(channel_id))
    sql += f' ORDER BY m.created_at DESC LIMIT {int(limit)}'
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()
    return jsonify({'messages': [{'id': r[0], 'channel_id': r[1], 'sender_name': r[2], 'content': r[3], 'has_image': r[4], 'created_at': r[5], 'channel_name': r[6]} for r in rows]})

@app.route('/api/channel_counts')
def get_channel_counts():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT channel_id, COUNT(*) FROM messages GROUP BY channel_id')
    rows = cursor.fetchall()
    conn.close()
    return jsonify({r[0]: r[1] for r in rows})

@app.route('/api/image/<int:msg_id>')
def get_image(msg_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT image_path FROM messages WHERE id = ?', (msg_id,))
    row = cursor.fetchone()
    conn.close()
    if row and row[0] and os.path.exists(row[0]):
        return send_file(row[0])
    return '', 404

@app.route('/api/channels', methods=['GET'])
def get_channels():
    active_only = request.args.get('active_only')
    conn = get_db()
    cursor = conn.cursor()
    sql = 'SELECT id, name, type, last_message_at, active FROM channels'
    if active_only:
        sql += ' WHERE active = 1'
    sql += ' ORDER BY name ASC'
    cursor.execute(sql)
    rows = cursor.fetchall()
    conn.close()
    return jsonify({'channels': [{'id': r[0], 'name': r[1], 'type': r[2], 'last_message_at': r[3], 'active': r[4]} for r in rows]})

@app.route('/api/channels/<int:channel_id>/toggle', methods=['POST'])
def toggle_channel(channel_id):
    data = request.json
    active = 1 if data.get('active') else 0
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE channels SET active = ?, last_message_at = ? WHERE id = ?', (active, datetime.now().isoformat() if active else None, channel_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/requirements', methods=['GET', 'POST'])
def requirements():
    conn = get_db()
    cursor = conn.cursor()
    if request.method == 'POST':
        data = request.json
        cursor.execute('INSERT INTO requirements (title, content, source, status, created_at) VALUES (?, ?, ?, ?, ?)', (data['title'], data.get('content', ''), 'manual', 'pending', datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    query = request.args.get('q', '')
    sql = 'SELECT id, title, content, source, status, created_at FROM requirements'
    params = []
    if query:
        sql += ' WHERE title LIKE ? OR content LIKE ?'
        params = [f'%{query}%', f'%{query}%']
    sql += ' ORDER BY created_at DESC LIMIT 50'
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()
    return jsonify({'requirements': [{'id': r[0], 'title': r[1], 'content': r[2], 'source': r[3], 'status': r[4], 'created_at': r[5]} for r in rows]})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3001, debug=False)
