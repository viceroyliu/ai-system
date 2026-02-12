#!/bin/bash
# ============================================
# 彻底清理 - 从 Git 中移除不需要的文件
# ============================================

cd ~/ai-system

echo "========================================"
echo "🧹 彻底清理 Git 仓库"
echo "========================================"

# 1. 确保 .gitignore 存在
echo ""
echo "1. 检查 .gitignore..."

cat > .gitignore << 'EOF'
# ==================== 运行时数据 ====================
data/
cache/

# ==================== Python ====================
venv/
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
*.egg-info/
.eggs/
dist/
build/

# ==================== 日志 ====================
logs/*.log
*.log

# ==================== Telegram ====================
*.session
*.session-journal

# ==================== 环境变量 ====================
.env
.env.local
.env.*.local

# ==================== IDE ====================
.idea/
.vscode/
*.swp
*.swo
*~
.DS_Store

# ==================== 临时文件 ====================
tmp/
temp/
*.tmp
*.temp
*.bak

# ==================== 备份文件 ====================
*.bak
EOF

echo "   ✅ .gitignore 已更新"

# 2. 从 Git 索引中移除（但保留本地文件）
echo ""
echo "2. 从 Git 跟踪中移除大文件和敏感目录..."

git rm -r --cached data/ 2>/dev/null && echo "   ✅ data/"
git rm -r --cached cache/ 2>/dev/null && echo "   ✅ cache/"
git rm -r --cached venv/ 2>/dev/null && echo "   ✅ venv/"
git rm -r --cached logs/ 2>/dev/null && echo "   ✅ logs/"
git rm --cached *.session 2>/dev/null && echo "   ✅ *.session"
git rm --cached sync/*.bak 2>/dev/null && echo "   ✅ *.bak"

# 3. 删除本地不需要的目录
echo ""
echo "3. 删除本地不需要的数据..."

# 删除旧的 chroma_db
if [ -d "data/chroma_db" ]; then
    rm -rf data/chroma_db
    echo "   ✅ 删除 data/chroma_db"
fi

# 删除 cache/chroma（onnx 模型会在需要时自动下载）
if [ -d "cache/chroma" ]; then
    rm -rf cache/chroma
    echo "   ✅ 删除 cache/chroma (onnx 模型会自动重新下载)"
fi

# 如果 cache 目录空了就删除
if [ -d "cache" ] && [ -z "$(ls -A cache 2>/dev/null)" ]; then
    rm -rf cache
    echo "   ✅ 删除空的 cache 目录"
fi

# 4. 创建必要的空目录和 .gitkeep
echo ""
echo "4. 创建目录占位文件..."

mkdir -p logs
touch logs/.gitkeep
echo "   ✅ logs/.gitkeep"

# 5. 删除备份文件
echo ""
echo "5. 删除备份文件..."
rm -f sync/*.bak
echo "   ✅ 删除 .bak 文件"

# 6. 查看将要提交的更改
echo ""
echo "6. Git 状态预览..."
echo "----------------------------------------"
git status --short | head -30
echo "----------------------------------------"

# 7. 提交
echo ""
echo "7. 提交更改..."
git add .gitignore
git add logs/.gitkeep
git add -A

git commit -m "chore: 清理仓库，移除大文件和敏感数据

- 移除 venv/ (297MB)
- 移除 cache/chroma/ (167MB, onnx 模型)
- 移除 data/ (敏感数据)
- 移除 logs/
- 添加规范的 .gitignore
- 统一向量数据库路径为 data/vector-db"

# 8. 强制推送
echo ""
echo "8. 推送到远程..."
git push --force-with-lease

echo ""
echo "========================================"
echo "✅ 清理完成！"
echo ""
echo "仓库大小对比："
echo "  清理前: ~500MB"
echo "  清理后: 应该 < 5MB"
echo ""
echo "注意: cache/chroma 中的 onnx 模型会在首次运行时自动下载"
echo "========================================"
