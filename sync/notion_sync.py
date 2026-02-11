#!/usr/bin/env python3
"""
Notion 同步服务 - 修复版
"""
import os
import yaml
import json
import time
import sqlite3
from datetime import datetime
from pathlib import Path
from notion_client import Client

CONFIG_PATH = Path("/app/config/telegram.yaml") if Path("/app/config").exists() else Path.home() / "ai-system/config/telegram.yaml"
DATA_PATH = Path("/app/data") if Path("/app/data").exists() else Path.home() / "ai-system/data"

# 读取配置
with open(CONFIG_PATH) as f:
    config = yaml.safe_load(f)

NOTION_TOKEN = os.getenv("NOTION_TOKEN", "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")
DATABASES = {
    "复盘": os.getenv("NOTION_DB_REVIEW", "17ff09e4bff78094a6b5d9a5fcf5bd77"),
    "目标": os.getenv("NOTION_DB_GOALS", "17ff09e4bff78127803bfb38db9ea6f7"),
    "闪念": os.getenv("NOTION_DB_FLASH", "17ff09e4bff7809aa134fc07c9f92f2f"),
    "AI笔记": os.getenv("NOTION_DB_NOTES", "18af09e4bff78006bcd5ede4d0fe0d85")
}

notion = Client(auth=NOTION_TOKEN)

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def query_database(database_id, filter_dict=None):
    """兼容新旧 API"""
    try:
        # 新版 API
        if filter_dict:
            return notion.databases.query(database_id=database_id, filter=filter_dict)
        return notion.databases.query(database_id=database_id)
    except AttributeError:
        # 旧版 API（如果还在使用）
        try:
            if filter_dict:
                return notion.databases.query_database(database_id=database_id, filter=filter_dict)
            return notion.databases.query_database(database_id=database_id)
        except:
            log(f"   ❌ API 调用失败")
            return {"results": []}
    except Exception as e:
        log(f"   ❌ 查询错误: {e}")
        return {"results": []}

def sync_from_notion():
    """从 Notion 同步数据"""
    log("开始同步...")
    
    for name, db_id in DATABASES.items():
        try:
            results = query_database(db_id)
            pages = results.get("results", [])
            log(f"   Notion [{name}]: {len(pages)} 条")
            
            # 这里可以添加具体的同步逻辑
            # 例如保存到本地数据库或文件
            
        except Exception as e:
            log(f"   ❌ 同步 [{name}] 失败: {e}")

def sync_to_notion():
    """同步本地数据到 Notion"""
    # 可以添加将本地数据推送到 Notion 的逻辑
    pass

def main():
    log("🚀 Notion 同步服务启动")
    
    while True:
        try:
            log("")
            log("=" * 50)
            log(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 新同步开始")
            log("=" * 50)
            
            sync_from_notion()
            sync_to_notion()
            
            log("✅ 同步完成")
            
        except Exception as e:
            log(f"❌ 同步错误: {e}")
        
        time.sleep(3600)  # 每小时同步一次

if __name__ == "__main__":
    main()
