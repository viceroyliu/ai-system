#!/usr/bin/env python3
import os, sqlite3, json, requests
from datetime import datetime, timedelta
from pathlib import Path
from flask import Flask, request, jsonify, send_file, send_from_directory, render_template

DATA_PATH = Path("/app/data") if Path("/app/data").exists() else Path.home() / "ai-system/data"
DB_PATH = DATA_PATH / "telegram.db"
IMAGES_PATH = DATA_PATH / "telegram_images"
SETTINGS_PATH = DATA_PATH / "tg_settings.json"
STATUS_PATH = DATA_PATH / "tg_status.json"
SEND_QUEUE_PATH = DATA_PATH / "send_queue.json"
MY_ID_PATH = DATA_PATH / "my_user_id.txt"

TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"

app = Flask(__name__, template_folder=str(TEMPLATE_DIR), static_folder=str(STATIC_DIR))

def db():
    return sqlite3.connect(str(DB_PATH))

def get_settings():
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH) as f:
            return json.load(f)
    return {
        'theme': 'dark', 
        'order': [], 
        'read': {}, 
        'aiModel': 'qwen2.5:14b-instruct',
        'aiPrompt': '你是一个专业的助手，根据以下聊天记录生成简洁的回复建议（50字以内）：',
        'requirementChannels': [2333658668]
    }

def save_settings(s):
    with open(SETTINGS_PATH, 'w') as f:
        json.dump(s, f)

def get_status():
    if STATUS_PATH.exists():
        try:
            with open(STATUS_PATH) as f:
                return json.load(f)
        except: pass
    return {'connected': False}

def get_my_user_id():
    if MY_ID_PATH.exists():
        try:
            with open(MY_ID_PATH) as f:
                return int(f.read().strip())
        except: pass
    return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:p>')
def static_files(p):
    return send_from_directory(str(STATIC_DIR), p)

@app.route('/api/status')
def api_status():
    return jsonify(get_status())

@app.route('/api/my_user_id')
def api_my_user_id():
    return jsonify({'user_id': get_my_user_id()})

@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    if request.method == 'POST':
        save_settings(request.json)
        return jsonify({'success': True})
    return jsonify(get_settings())

@app.route('/api/channels', methods=['GET'])
def api_channels():
    active_only = request.args.get('active_only')
    settings = get_settings()
    req_channels = settings.get('requirementChannels', [])
    
    conn = db()
    cursor = conn.cursor()
    sql = 'SELECT id, name, type, last_message_at, active, pinned FROM channels'
    if active_only: sql += ' WHERE active = 1'
    sql += ' ORDER BY name'
    cursor.execute(sql)
    rows = cursor.fetchall()
    conn.close()
    
    return jsonify({'channels': [{
        'id': r[0], 
        'name': r[1], 
        'type': r[2], 
        'last_message_at': r[3], 
        'active': r[4], 
        'pinned': r[5] if len(r) > 5 else 0,
        'is_requirement_channel': r[0] in req_channels
    } for r in rows]})

@app.route('/api/channels/<int:cid>/toggle', methods=['POST'])
def toggle_channel(cid):
    active = 1 if request.json.get('active') else 0
    conn = db()
    cursor = conn.cursor()
    cursor.execute('UPDATE channels SET active = ? WHERE id = ?', (active, cid))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/channels/<int:cid>/pin', methods=['POST'])
def pin_channel(cid):
    pinned = 1 if request.json.get('pinned') else 0
    conn = db()
    cursor = conn.cursor()
    cursor.execute('UPDATE channels SET pinned = ? WHERE id = ?', (pinned, cid))
    conn.commit()
    conn.close()
    print(f'[置顶] {cid} -> {pinned}')
    return jsonify({'success': True})

@app.route('/api/channels/<int:cid>/messages', methods=['DELETE'])
def delete_channel_messages(cid):
    conn = db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM messages WHERE channel_id = ?', (cid,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/channel_counts')
def channel_counts():
    conn = db()
    cursor = conn.cursor()
    cursor.execute('SELECT channel_id, COUNT(*) FROM messages GROUP BY channel_id')
    rows = cursor.fetchall()
    conn.close()
    return jsonify({r[0]: r[1] for r in rows})

@app.route('/api/last_messages')
def last_messages():
    conn = db()
    cursor = conn.cursor()
    cursor.execute('''SELECT m.channel_id, m.sender_name, m.content, m.created_at
                      FROM messages m INNER JOIN 
                      (SELECT channel_id, MAX(created_at) as t FROM messages GROUP BY channel_id) 
                      l ON m.channel_id = l.channel_id AND m.created_at = l.t''')
    rows = cursor.fetchall()
    conn.close()
    return jsonify({r[0]: {'sender_name': r[1], 'content': r[2], 'created_at': r[3]} for r in rows})

@app.route('/api/messages')
def api_messages():
    cid = request.args.get('channel_id')
    q = request.args.get('q', '')
    limit = request.args.get('limit', 100)
    my_id = get_my_user_id()
    
    conn = db()
    cursor = conn.cursor()
    sql = '''SELECT m.id, m.channel_id, m.sender_name, m.sender_id, m.content, m.has_image, 
             m.created_at, c.name, m.is_outgoing, m.media_type 
             FROM messages m LEFT JOIN channels c ON m.channel_id = c.id WHERE 1=1'''
    params = []
    
    if cid:
        sql += ' AND m.channel_id = ?'
        params.append(int(cid))
    if q:
        sql += ' AND m.content LIKE ?'
        params.append(f'%{q}%')
    
    sql += f' ORDER BY m.created_at DESC LIMIT {int(limit)}'
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()
    
    return jsonify({'messages': [{
        'id': r[0], 'channel_id': r[1], 'sender_name': r[2], 'sender_id': r[3],
        'content': r[4], 'has_image': r[5], 'created_at': r[6], 'channel_name': r[7], 
        'is_outgoing': bool(r[8]) or (r[3] == my_id if my_id and r[3] else False),
        'media_type': r[9] if len(r) > 9 else None
    } for r in rows]})

@app.route('/api/messages/<int:mid>', methods=['DELETE'])
def delete_message(mid):
    conn = db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM messages WHERE id = ?', (mid,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/image/<int:mid>')
def get_image(mid):
    conn = db()
    cursor = conn.cursor()
    cursor.execute('SELECT image_path FROM messages WHERE id = ?', (mid,))
    row = cursor.fetchone()
    conn.close()
    if row and row[0] and os.path.exists(row[0]):
        return send_file(row[0])
    return '', 404

@app.route('/api/requirements', methods=['GET', 'POST'])
def api_requirements():
    conn = db()
    cursor = conn.cursor()
    
    if request.method == 'POST':
        content = request.json.get('content', '')
        status = 'done' if '已处理' in content else 'pending'
        cursor.execute('INSERT INTO requirements (title, content, source, status, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                       ('', content, 'manual', status, 0, datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    cursor.execute('SELECT id, title, content, source, status, pinned, created_at FROM requirements WHERE status != "closed" ORDER BY created_at DESC')
    rows = cursor.fetchall()
    conn.close()
    
    requirements = []
    for row in rows:
        req = {
            'id': row[0], 
            'title': row[1], 
            'content': row[2], 
            'source': row[3], 
            'status': row[4], 
            'pinned': row[5], 
            'created_at': row[6],
            'is_reply': row[3] and row[3].startswith('reply:') if row[3] else False
        }
        requirements.append(req)
    
    return jsonify({'requirements': requirements})

@app.route('/api/requirements/<int:rid>', methods=['PUT', 'DELETE'])
def requirement_detail(rid):
    conn = db()
    cursor = conn.cursor()
    
    if request.method == 'DELETE':
        cursor.execute('DELETE FROM requirements WHERE id = ?', (rid,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    data = request.json
    updates, params = [], []
    
    auto_reply_needed = False
    reply_to_msg_id = None
    channel_id = None
    
    if 'status' in data and data['status'] == 'done':
        cursor.execute('SELECT status, source FROM requirements WHERE id = ?', (rid,))
        row = cursor.fetchone()
        if row and row[0] == 'pending' and row[1] and row[1].startswith('channel:'):
            auto_reply_needed = True
            parts = row[1].split(':')
            if len(parts) >= 3:
                channel_id = int(parts[1])
                reply_to_msg_id = int(parts[2])
    
    if 'status' in data:
        updates.append('status = ?')
        params.append(data['status'])
    if 'pinned' in data:
        updates.append('pinned = ?')
        params.append(1 if data['pinned'] else 0)
    
    if updates:
        params.append(rid)
        cursor.execute(f'UPDATE requirements SET {", ".join(updates)} WHERE id = ?', params)
        conn.commit()
    
    conn.close()
    
    # 自动回复
    if auto_reply_needed and channel_id and reply_to_msg_id:
        queue = []
        if SEND_QUEUE_PATH.exists():
            try:
                with open(SEND_QUEUE_PATH) as f:
                    queue = json.load(f)
            except: pass
        
        queue.append({
            'channel_id': channel_id,
            'content': '已处理',
            'reply_to_msg_id': reply_to_msg_id,
            'timestamp': datetime.now().isoformat()
        })
        
        with open(SEND_QUEUE_PATH, 'w') as f:
            json.dump(queue, f)
        
        print(f'[自动回复] 需求 {rid} 引用回复')
    
    return jsonify({'success': True})

@app.route('/api/send_message', methods=['POST'])
def send_message():
    data = request.json
    cid = data.get('channel_id')
    content = data.get('content')
    
    if not cid or not content:
        return jsonify({'success': False, 'error': '缺少参数'})
    
    queue = []
    if SEND_QUEUE_PATH.exists():
        try:
            with open(SEND_QUEUE_PATH) as f:
                queue = json.load(f)
        except: pass
    
    queue.append({'channel_id': cid, 'content': content, 'timestamp': datetime.now().isoformat()})
    
    with open(SEND_QUEUE_PATH, 'w') as f:
        json.dump(queue, f)
    
    print(f'[发送] {cid} - {content[:30]}')
    return jsonify({'success': True})

@app.route('/api/ai_assist', methods=['POST'])
def ai_assist():
    data = request.json
    messages = data.get('messages', [])
    custom_prompt = data.get('prompt', '')
    model = data.get('model', 'qwen2.5:14b-instruct')
    
    if not messages:
        return jsonify({'reply': '请提供聊天记录', 'success': False})
    
    context = '\n'.join(messages)
    prompt_text = custom_prompt or '你是一个专业的助手，根据以下聊天记录生成简洁的回复建议（50字以内）：'
    full_prompt = f"{prompt_text}\n\n{context}\n\n回复建议："
    
    try:
        ollama_url = 'http://host.docker.internal:11434' if Path("/app/data").exists() else 'http://localhost:11434'
        
        res = requests.post(f'{ollama_url}/api/generate', json={
            'model': model,
            'prompt': full_prompt,
            'stream': False,
            'options': {'temperature': 0.7, 'num_predict': 150}
        }, timeout=90)
        
        if res.status_code == 200:
            result = res.json()
            reply = result.get('response', '').strip()
            return jsonify({'reply': reply or 'AI 未返回内容', 'success': True})
        else:
            return jsonify({'reply': f'AI 服务错误 (HTTP {res.status_code})', 'success': False})
            
    except Exception as e:
        return jsonify({'reply': f'AI 不可用: {str(e)}', 'success': False})

@app.route('/api/refresh_channels', methods=['POST'])
def refresh_channels():
    try:
        import subprocess
        script = Path(__file__).parent.parent / 'tg_refresh.py'
        subprocess.run(['python3', str(script)], capture_output=True, timeout=60)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    conn = db()
    cursor = conn.cursor()
    try: cursor.execute('ALTER TABLE requirements ADD COLUMN pinned INTEGER DEFAULT 0')
    except: pass
    try: cursor.execute('ALTER TABLE messages ADD COLUMN is_outgoing INTEGER DEFAULT 0')
    except: pass
    try: cursor.execute('ALTER TABLE messages ADD COLUMN sender_id INTEGER')
    except: pass
    try: cursor.execute('ALTER TABLE channels ADD COLUMN pinned INTEGER DEFAULT 0')
    except: pass
    try: cursor.execute('ALTER TABLE messages ADD COLUMN media_type TEXT')
    except: pass
    conn.commit()
    conn.close()
    
    print('🚀 Telegram Web 启动: http://0.0.0.0:3001')
    app.run(host='0.0.0.0', port=3001, debug=True, threaded=True)

@app.route('/api/image/<int:mid>')
def get_image(mid):
    conn = db()
    cursor = conn.cursor()
    cursor.execute('SELECT image_path FROM messages WHERE id = ?', (mid,))
    row = cursor.fetchone()
    conn.close()
    if row and row[0] and os.path.exists(row[0]):
        return send_file(row[0])
    return '', 404
