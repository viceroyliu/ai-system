#!/usr/bin/env python3
"""
刷新 Telegram 频道列表 - 保存正确 ID
"""
import asyncio
import sqlite3
from pathlib import Path
from telethon import TelegramClient
from telethon.tl.types import Channel, Chat, User

API_ID = 32556414
API_HASH = "c33ce24df5625720b775735c62094477"

if Path("/app/data").exists():
    DATA_PATH = Path("/app/data")
    PROXY = {'proxy_type': 'http', 'addr': 'host.docker.internal', 'port': 6152}
else:
    DATA_PATH = Path.home() / "ai-system/data"
    PROXY = {'proxy_type': 'http', 'addr': '127.0.0.1', 'port': 6152}

DB_PATH = DATA_PATH / "telegram.db"
SESSION_PATH = DATA_PATH / "ai_monitor"

async def main():
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH, proxy=PROXY)
    await client.start()
    
    dialogs = await client.get_dialogs()
    
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    count = 0
    for dialog in dialogs:
        entity = dialog.entity
        chat_name = dialog.name or "未知"
        
        # 跳过私聊（私聊由监听服务自动添加）
        if isinstance(entity, User):
            continue
        
        if isinstance(entity, Channel):
            # Channel ID 就是 entity.id，不需要额外处理
            chat_id = entity.id
            chat_type = 'channel' if not entity.megagroup else 'group'
        elif isinstance(entity, Chat):
            chat_id = entity.id
            chat_type = 'group'
        else:
            continue
        
        cursor.execute('''
            INSERT OR IGNORE INTO channels (id, name, type, active)
            VALUES (?, ?, ?, 0)
        ''', (chat_id, chat_name, chat_type))
        
        cursor.execute('UPDATE channels SET name = ? WHERE id = ?', (chat_name, chat_id))
        count += 1
    
    conn.commit()
    conn.close()
    
    print(f"已更新 {count} 个频道/群组")
    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
