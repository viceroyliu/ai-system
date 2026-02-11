#!/usr/bin/env python3
"""
Telegram 监听服务
"""
import os
import asyncio
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from telethon import TelegramClient, events

API_ID = 32556414
API_HASH = "c33ce24df5625720b775735c62094477"

# 检测环境
if Path("/app/data").exists():
    DATA_PATH = Path("/app/data")
    # Docker 环境，通过 host.docker.internal 连接宿主机代理
    PROXY = {'proxy_type': 'http', 'addr': 'host.docker.internal', 'port': 6152}
else:
    DATA_PATH = Path.home() / "ai-system/data"
    PROXY = {'proxy_type': 'http', 'addr': '127.0.0.1', 'port': 6152}

DB_PATH = DATA_PATH / "telegram.db"
IMAGES_PATH = DATA_PATH / "telegram_images"
SESSION_PATH = DATA_PATH / "ai_monitor"
STATUS_PATH = DATA_PATH / "tg_status.json"
SEND_QUEUE_PATH = DATA_PATH / "send_queue.json"

IMAGES_PATH.mkdir(parents=True, exist_ok=True)

active_channel_ids = set()

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def update_status(connected, error=None):
    try:
        with open(STATUS_PATH, 'w') as f:
            json.dump({'connected': connected, 'last_update': datetime.now().isoformat(), 'error': error}, f)
    except:
        pass

def extract_real_id(chat_id):
    s = str(chat_id)
    if s.startswith('-100'): return int(s[4:])
    if s.startswith('-'): return int(s[1:])
    return abs(int(chat_id))

def get_active_channels():
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM channels WHERE active = 1")
        channels = cursor.fetchall()
        conn.close()
        return channels
    except:
        return []

def save_message(channel_id, message_id, sender_name, content, image_path=None, is_outgoing=False):
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute('''INSERT OR IGNORE INTO messages 
                          (channel_id, message_id, sender_name, content, has_image, image_path, created_at, is_outgoing)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                       (channel_id, message_id, sender_name, content, 1 if image_path else 0, image_path, 
                        datetime.now().isoformat(), 1 if is_outgoing else 0))
        cursor.execute('UPDATE channels SET last_message_at = ? WHERE id = ?', (datetime.now().isoformat(), channel_id))
        conn.commit()
        conn.close()
    except Exception as e:
        log(f"❌ 保存消息失败: {e}")

def add_channel(channel_id, name, channel_type='private'):
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute('INSERT OR IGNORE INTO channels (id, name, type, active) VALUES (?, ?, ?, 1)', (channel_id, name, channel_type))
        cursor.execute('UPDATE channels SET name = ?, last_message_at = ? WHERE id = ?', (name, datetime.now().isoformat(), channel_id))
        conn.commit()
        conn.close()
    except:
        pass

def refresh_channels():
    global active_channel_ids
    channels = get_active_channels()
    new_ids = set(c[0] for c in channels)
    if new_ids != active_channel_ids:
        active_channel_ids = new_ids
        log(f"📡 监听 {len(active_channel_ids)} 个频道")
    return active_channel_ids

async def process_send_queue(client):
    if not SEND_QUEUE_PATH.exists():
        return
    
    try:
        with open(SEND_QUEUE_PATH) as f:
            queue = json.load(f)
    except:
        return
    
    if not queue:
        return
    
    new_queue = []
    
    for item in queue:
        try:
            channel_id = item['channel_id']
            content = item['content']
            
            entity = None
            for prefix in [f'-100{channel_id}', f'-{channel_id}', str(channel_id), int(channel_id)]:
                try:
                    entity = await client.get_entity(int(prefix) if isinstance(prefix, str) else prefix)
                    break
                except:
                    continue
            
            if not entity:
                log(f"❌ 找不到频道: {channel_id}")
                continue
            
            msg = await client.send_message(entity, content)
            save_message(channel_id, msg.id, 'Me', content, is_outgoing=True)
            log(f"📤 发送成功: {content[:30]}...")
        except Exception as e:
            log(f"❌ 发送失败: {e}")
    
    with open(SEND_QUEUE_PATH, 'w') as f:
        json.dump(new_queue, f)

async def run_client():
    global active_channel_ids
    
    log(f"🔗 连接中... 代理: {PROXY['addr']}:{PROXY['port']}")
    
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH, proxy=PROXY)
    
    @client.on(events.NewMessage)
    async def handler(event):
        try:
            raw_chat_id = event.chat_id
            chat = await event.get_chat()
            chat_name = getattr(chat, 'title', None) or getattr(chat, 'first_name', None) or str(raw_chat_id)
            real_id = extract_real_id(raw_chat_id)
            
            is_private = raw_chat_id > 0
            is_outgoing = event.message.out
            
            sender = await event.get_sender()
            sender_name = 'Me' if is_outgoing else (getattr(sender, 'first_name', '') if sender else 'Unknown')
            content = event.message.text or ""
            
            if is_private:
                add_channel(real_id, chat_name, 'private')
            elif real_id not in active_channel_ids and not is_outgoing:
                return
            
            image_path = None
            if event.message.photo:
                filename = f"{real_id}_{event.message.id}.jpg"
                image_path = str(IMAGES_PATH / filename)
                try:
                    await event.message.download_media(file=image_path)
                except:
                    image_path = None
            
            save_message(real_id, event.message.id, sender_name, content, image_path, is_outgoing)
            preview = content[:30] + "..." if len(content) > 30 else content
            log(f"{'📤' if is_outgoing else '📨'} [{chat_name}] {sender_name}: {preview}")
        except Exception as e:
            log(f"❌ 处理消息错误: {e}")
    
    await client.start()
    update_status(True)
    refresh_channels()
    log(f"🚀 监听服务已启动")
    
    async def refresh_task():
        while True:
            await asyncio.sleep(60)
            refresh_channels()
    
    async def send_task():
        while True:
            await asyncio.sleep(3)
            try:
                await process_send_queue(client)
            except:
                pass
    
    asyncio.create_task(refresh_task())
    asyncio.create_task(send_task())
    
    await client.run_until_disconnected()

async def main():
    retry = 5
    while True:
        try:
            await run_client()
        except Exception as e:
            log(f"⚠️ 断开: {e}")
            update_status(False, str(e))
            log(f"⏳ {retry}秒后重连...")
            await asyncio.sleep(retry)
            retry = min(retry * 2, 300)
        else:
            retry = 5

if __name__ == "__main__":
    asyncio.run(main())
