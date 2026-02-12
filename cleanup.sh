#!/bin/bash
# ============================================
# AI 系统项目清理脚本
# 用途：清理无用文件、统一数据路径、准备 Git 提交
# ============================================

set -e
cd ~/ai-system

echo "========================================"
echo "🧹 AI 系统项目清理"
echo "========================================"
echo ""

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ----------------------------------------
# 1. 分析当前目录结构
# ----------------------------------------
echo -e "${BLUE}📊 当前目录分析${NC}"
echo "----------------------------------------"

echo "目录大小统计："
du -sh */ 2>/dev/null | sort -hr

echo ""
echo "大文件 (>10MB)："
find . -type f -size +10M -exec ls -lh {} \; 2>/dev/null | awk '{print $5, $9}' | head -20

echo ""

# ----------------------------------------
# 2. 识别各类文件
# ----------------------------------------
echo -e "${BLUE}📁 文件分类${NC}"
echo "----------------------------------------"

echo -e "${GREEN}✅ 需要保留的代码文件：${NC}"
echo "   - config/*.yaml (配置)"
echo "   - sync/*.py (同步服务)"
echo "   - telegram/*.py (Telegram 模块)"
echo "   - scripts/*.py (工具脚本)"
echo "   - docker-compose.yml, start.sh, stop.sh"
echo "   - STATUS.md, README.md"

echo ""
echo -e "${YELLOW}⚠️ 应该加入 .gitignore 的：${NC}"
echo "   - venv/ (Python 虚拟环境)"
echo "   - data/ (运行时数据，含敏感信息)"
echo "   - cache/ (缓存文件)"
echo "   - logs/ (日志文件)"
echo "   - *.session (Telegram 登录凭证)"
echo "   - __pycache__/ (Python 缓存)"

echo ""
echo -e "${RED}❌ 可以删除的：${NC}"

# 检查空目录
empty_dirs=$(find . -type d -empty 2>/dev/null | grep -v ".git" | head -10)
if [ -n "$empty_dirs" ]; then
    echo "   空目录："
    echo "$empty_dirs" | sed 's/^/   /'
fi

# 检查旧日志
old_logs=$(find ./logs -name "*.log" -mtime +7 2>/dev/null)
if [ -n "$old_logs" ]; then
    echo "   超过7天的日志："
    echo "$old_logs" | sed 's/^/   /'
fi

# 检查重复/废弃的数据库目录
echo ""
echo "   可能重复的数据库目录："
for dir in "data/chroma_db" "data/vector-db" "cache/chroma"; do
    if [ -d "$dir" ]; then
        size=$(du -sh "$dir" 2>/dev/null | cut -f1)
        count=$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')
        echo "   - $dir ($size, $count 文件)"
    fi
done

echo ""

# ----------------------------------------
# 3. 询问是否执行清理
# ----------------------------------------
echo -e "${BLUE}🔧 建议的清理操作${NC}"
echo "----------------------------------------"
echo "1. 删除空的 cache/chroma 目录"
echo "2. 统一向量数据库到 data/vector-db"
echo "3. 清理旧日志文件"
echo "4. 删除 venv 中的缓存"
echo "5. 创建规范的 .gitignore"
echo ""

read -p "是否执行清理? (y/n): " confirm

if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    echo ""
    echo -e "${GREEN}执行清理...${NC}"
    
    # 删除空的 cache/chroma
    if [ -d "cache/chroma" ]; then
        file_count=$(find cache/chroma -type f 2>/dev/null | wc -l | tr -d ' ')
        if [ "$file_count" -eq 0 ]; then
            rm -rf cache/chroma
            echo "✅ 删除空目录: cache/chroma"
        fi
    fi
    
    # 如果 cache 目录为空，也删除
    if [ -d "cache" ] && [ -z "$(ls -A cache 2>/dev/null)" ]; then
        rm -rf cache
        echo "✅ 删除空目录: cache"
    fi
    
    # 清理旧日志 (保留最近3天)
    find ./logs -name "*.log" -mtime +3 -delete 2>/dev/null && echo "✅ 清理旧日志"
    
    # 清理 Python 缓存
    find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
    find . -type f -name "*.pyc" -delete 2>/dev/null
    echo "✅ 清理 Python 缓存"
    
    # 清理日志内容（保留文件，清空内容）
    for log in logs/*.log; do
        if [ -f "$log" ]; then
            > "$log"
        fi
    done
    echo "✅ 清空日志文件内容"
    
    echo ""
    echo -e "${GREEN}✅ 清理完成${NC}"
else
    echo "跳过清理"
fi

echo ""
echo "========================================"
echo "清理脚本执行完毕"
echo "========================================"
