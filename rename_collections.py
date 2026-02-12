#!/usr/bin/env python3
"""
重命名向量数据库 Collection
- notion_knowledge → blog
- knowledge → notion
"""
import chromadb
from pathlib import Path

DB_PATH = Path.home() / "ai-system/data/vector-db"

def migrate_collection(client, old_name, new_name):
    """迁移 collection 数据"""
    try:
        old_col = client.get_collection(old_name)
        results = old_col.get(include=["documents", "metadatas", "embeddings"])
        
        if not results['ids']:
            print(f"  ⚠️ {old_name} 是空的，跳过")
            return False
        
        count = len(results['ids'])
        print(f"  📦 {old_name} → {new_name} ({count} 条)")
        
        # 创建新 collection 并导入数据
        new_col = client.get_or_create_collection(new_name)
        
        # 分批导入（避免内存问题）
        batch_size = 100
        for i in range(0, count, batch_size):
            end = min(i + batch_size, count)
            new_col.add(
                ids=results['ids'][i:end],
                documents=results['documents'][i:end] if results['documents'] else None,
                metadatas=results['metadatas'][i:end] if results['metadatas'] else None,
                embeddings=results['embeddings'][i:end] if results['embeddings'] else None
            )
        
        # 验证
        new_count = new_col.count()
        if new_count == count:
            print(f"  ✅ 迁移成功: {new_count} 条")
            # 删除旧 collection
            client.delete_collection(old_name)
            print(f"  🗑️ 已删除旧的 {old_name}")
            return True
        else:
            print(f"  ❌ 数量不匹配: 期望 {count}, 实际 {new_count}")
            return False
            
    except Exception as e:
        print(f"  ❌ 迁移失败: {e}")
        return False

def main():
    print("=" * 50)
    print("🔄 重命名 Collection")
    print("=" * 50)
    print()
    
    client = chromadb.PersistentClient(path=str(DB_PATH))
    
    # 显示当前状态
    print("📊 当前 Collections:")
    for col in client.list_collections():
        print(f"  - {col.name}: {col.count()} 条")
    print()
    
    # 迁移计划
    migrations = [
        ("notion_knowledge", "blog"),    # 博客笔记
        ("knowledge", "notion"),          # Notion 同步数据
    ]
    
    print("📋 迁移计划:")
    for old, new in migrations:
        print(f"  {old} → {new}")
    print()
    
    # 确认
    confirm = input("确认执行迁移? (y/n): ")
    if confirm.lower() != 'y':
        print("已取消")
        return
    
    print()
    print("🚀 开始迁移...")
    
    for old_name, new_name in migrations:
        try:
            # 检查旧 collection 是否存在
            client.get_collection(old_name)
            migrate_collection(client, old_name, new_name)
        except Exception as e:
            print(f"  ⚠️ {old_name} 不存在，跳过")
    
    print()
    print("📊 迁移后的 Collections:")
    for col in client.list_collections():
        print(f"  - {col.name}: {col.count()} 条")
    
    print()
    print("=" * 50)
    print("✅ 完成！")
    print()
    print("接下来需要：")
    print("1. 更新 sync_service.py 中的 collection 名称")
    print("2. 更新 .zshrc 中的命令")
    print("3. 重启 ai-sync 服务")
    print("=" * 50)

if __name__ == "__main__":
    main()
