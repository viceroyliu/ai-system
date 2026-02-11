#!/usr/bin/env python3
"""
Telegram 本地运行版 - 配置 Surge 代理
"""
import asyncio
import sqlite3
import python_socks
from pathlib import Path
from telethon import TelegramClient
from telethon.tl.types import Channel, Chat, User

API_ID = 32556414
API_HASH = "c33ce24df5625720b775735c62094477"
SESSION_PATH = Path.home() / "ai-system/data/ai_monitor"
DB_PATH = Path.home() / "ai-system/data/telegram.db"

def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS channels (
            id INTEGER PRIMARY KEY,
            name TEXT,
            type TEXT DEFAULT 'chat',
            last_message_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            active INTEGER DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id INTEGER,
            message_id INTEGER,
            sender_name TEXT,
            content TEXT,
            has_image INTEGER DEFAULT 0,
            image_path TEXT,
            created_at TEXT,
            UNIQUE(channel_id, message_id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS requirements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            content TEXT,
            source TEXT DEFAULT 'manual',
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )
    ''')
    conn.commit()
    conn.close()

async def main():
    init_db()
    
    print("🔗 使用 Surge HTTP 代理: 127.0.0.1:6152")
    
    # Telethon 使用 HTTP 代理
    client = TelegramClient(
        str(SESSION_PATH), 
        API_ID, 
        API_HASH,
        proxy={
            'proxy_type': 'http',
            'addr': '127.0.0.1',
            'port': 6152
        }
    )
    
    await client.start()
    
    print("\n✅ 登录成功！")
    print("\n📋 你加入的群组和频道：\n")
    
    dialogs = await client.get_dialogs()
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    groups = []
    channels = []
    
    for dialog in dialogs:
        entity = dialog.entity
        
        if isinstance(entity, Channel):
            if entity.megagroup:
                groups.append((entity.id, dialog.name, 'group'))
            else:
                channels.append((entity.id, dialog.name, 'channel'))
            
            cursor.execute('''
                INSERT OR IGNORE INTO channels (id, name, type, active)
                VALUES (?, ?, ?, 0)
            ''', (entity.id, dialog.name, 'channel' if not entity.megagroup else 'group'))
        
        elif isinstance(entity, Chat):
            groups.append((entity.id, dialog.name, 'group'))
            cursor.execute('''
                INSERT OR IGNORE INTO channels (id, name, type, active)
                VALUES (?, ?, 'group', 0)
            ''', (entity.id, dialog.name))
    
    conn.commit()
    conn.close()
    
    print("【频道】")
    for id, name, _ in channels:
        print(f"  {id}: {name}")
    
    print("\n【群组】")
    for id, name, _ in groups:
        print(f"  {id}: {name}")
    
    print(f"\n✅ 已保存 {len(groups) + len(channels)} 个群组/频道到数据库")
    print("请在网页 http://localhost:3001 中选择要监听的群组")
    
    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
