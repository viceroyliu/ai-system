#!/bin/bash
# ============================================
# 统一向量数据库路径
# 将所有服务改为使用 data/vector-db
# ============================================

cd ~/ai-system

echo "========================================"
echo "🔧 统一向量数据库路径"
echo "========================================"

# 1. 修复 sync_service.py 中的路径
echo ""
echo "1. 修复 sync/sync_service.py..."

if [ -f "sync/sync_service.py" ]; then
    # 备份
    cp sync/sync_service.py sync/sync_service.py.bak
    
    # 替换 chroma_db 为 vector-db
    sed -i '' 's|"chroma_db"|"vector-db"|g' sync/sync_service.py
    sed -i '' 's|/chroma_db|/vector-db|g' sync/sync_service.py
    
    echo "   ✅ 已修改 sync_service.py"
    echo "   📝 备份: sync/sync_service.py.bak"
else
    echo "   ❌ 文件不存在"
fi

# 2. 检查是否有 data/chroma_db 需要迁移
echo ""
echo "2. 检查旧数据库..."

if [ -d "data/chroma_db" ]; then
    echo "   发现 data/chroma_db"
    
    if [ -d "data/vector-db" ]; then
        echo "   data/vector-db 也存在"
        echo ""
        echo "   两个目录都有数据，需要手动决定："
        echo "   - data/chroma_db: $(du -sh data/chroma_db 2>/dev/null | cut -f1)"
        echo "   - data/vector-db: $(du -sh data/vector-db 2>/dev/null | cut -f1)"
        echo ""
        echo "   建议：如果 vector-db 的数据是你需要的，可以删除 chroma_db"
        echo "   运行: rm -rf data/chroma_db"
    else
        echo "   迁移 chroma_db -> vector-db..."
        mv data/chroma_db data/vector-db
        echo "   ✅ 迁移完成"
    fi
else
    echo "   ✅ 没有旧的 chroma_db 目录"
fi

# 3. 删除空的 cache 目录
echo ""
echo "3. 清理 cache 目录..."

if [ -d "cache/chroma" ]; then
    file_count=$(find cache/chroma -type f 2>/dev/null | wc -l | tr -d ' ')
    if [ "$file_count" -eq 0 ]; then
        rm -rf cache/chroma
        echo "   ✅ 删除空目录: cache/chroma"
    else
        echo "   ⚠️ cache/chroma 有 $file_count 个文件，跳过"
    fi
fi

if [ -d "cache" ] && [ -z "$(ls -A cache 2>/dev/null)" ]; then
    rm -rf cache
    echo "   ✅ 删除空目录: cache"
fi

# 4. 更新 .zshrc 中的路径 (如果需要)
echo ""
echo "4. 提示：请确认 .zshrc 中的 ai-list 等命令使用的是 data/vector-db"

# 5. 重启服务
echo ""
echo "5. 重启 ai-sync 服务..."
docker compose restart ai-sync
echo "   ✅ 服务已重启"

echo ""
echo "========================================"
echo "✅ 完成！"
echo ""
echo "验证命令："
echo "  ai-status    # 检查同步服务状态"
echo "  ai-list      # 列出向量数据库内容"
echo "========================================"
