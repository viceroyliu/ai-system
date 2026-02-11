#!/usr/bin/env python3
import sqlite3
from datetime import datetime

REQUIREMENT_CHANNELS = {
    2333658668: {
        'name': '股票需求发布',
        'auto_create': True,
        'auto_done_keywords': ['已处理', '完成', 'done']
    }
}

def should_create_requirement(cid):
    return cid in REQUIREMENT_CHANNELS and REQUIREMENT_CHANNELS[cid]['auto_create']

def should_mark_done(cid, cnt):
    if cid not in REQUIREMENT_CHANNELS: return False
    return any(k in cnt for k in REQUIREMENT_CHANNELS[cid]['auto_done_keywords'])

def create_or_update_requirement(db, cid, mid, cnt, reply_to=None):
    conn = sqlite3.connect(str(db))
    cursor = conn.cursor()
    
    if reply_to:
        # 这是回复，查找原需求
        parent_src = f'channel:{cid}:{reply_to}'
        cursor.execute('SELECT id FROM requirements WHERE source = ?', (parent_src,))
        parent = cursor.fetchone()
        
        if parent:
            reply_src = f'reply:{cid}:{mid}'
            cursor.execute('SELECT id FROM requirements WHERE source = ?', (reply_src,))
            if not cursor.fetchone():
                cursor.execute('INSERT INTO requirements (title, content, source, status, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                               ('', cnt, reply_src, 'done', 0, datetime.now().isoformat()))
                print(f'[需求] 回复: {cnt[:30]}...')
            conn.commit()
            conn.close()
            return 'reply'
    
    # 主需求
    src = f'channel:{cid}:{mid}'
    cursor.execute('SELECT id, status FROM requirements WHERE source = ?', (src,))
    exist = cursor.fetchone()
    
    stat = 'done' if should_mark_done(cid, cnt) else 'pending'
    
    if exist:
        cursor.execute('UPDATE requirements SET content = ?, status = ? WHERE id = ?', (cnt, stat, exist[0]))
        print(f'[需求] 更新: {cnt[:30]}...')
    else:
        cursor.execute('INSERT INTO requirements (title, content, source, status, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                       ('', cnt, src, stat, 0, datetime.now().isoformat()))
        print(f'[需求] 创建: {cnt[:30]}...')
    
    conn.commit()
    conn.close()
    return stat

def delete_requirement_by_message(db, cid, mid):
    conn = sqlite3.connect(str(db))
    cursor = conn.cursor()
    cursor.execute('DELETE FROM requirements WHERE source = ? OR source = ?', 
                   (f'channel:{cid}:{mid}', f'reply:{cid}:{mid}'))
    conn.commit()
    conn.close()
