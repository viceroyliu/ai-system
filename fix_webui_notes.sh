#!/bin/bash
# 修复 WebUI 笔记数据库中的错误记录
# 并更新 sync_service.py

cd ~/ai-system

echo "========================================"
echo "🔧 修复 WebUI 笔记问题"
echo "========================================"

# 1. 先停止服务
echo ""
echo "1. 停止服务..."
docker compose down

# 2. 清理错误的笔记数据
echo ""
echo "2. 清理错误数据..."

# 获取 Docker volume 路径
VOLUME_PATH=$(docker volume inspect open-webui --format '{{.Mountpoint}}')
echo "   Volume 路径: $VOLUME_PATH"

# 在 Docker Desktop for Mac 上，volume 在虚拟机里，需要用 docker run 来访问
docker run --rm -v open-webui:/data alpine sh -c "
    if [ -f /data/webui.db ]; then
        # 安装 sqlite
        apk add --no-cache sqlite > /dev/null 2>&1
        
        # 删除 user_id 为 NULL 的笔记（这些是错误创建的）
        sqlite3 /data/webui.db 'DELETE FROM note WHERE user_id IS NULL;'
        echo '   ✅ 已删除错误的笔记记录'
        
        # 显示剩余笔记数量
        COUNT=\$(sqlite3 /data/webui.db 'SELECT COUNT(*) FROM note;')
        echo \"   剩余笔记: \$COUNT 条\"
    else
        echo '   ⚠️ webui.db 不存在'
    fi
"

# 3. 更新同步模式为单向（暂时禁用 Notion → WebUI）
echo ""
echo "3. 更新配置为单向同步..."

# 检查当前配置
if grep -q "flow:" config/notion.yaml; then
    # 更新为单向
    sed -i '' 's/flow: "bidirectional"/flow: "webui_to_notion"/' config/notion.yaml
    echo "   ✅ 同步模式已改为: webui_to_notion"
else
    echo "   ⚠️ 未找到 flow 配置"
fi

# 4. 重启服务
echo ""
echo "4. 重启服务..."
docker compose up -d

echo ""
echo "========================================"
echo "✅ 修复完成！"
echo ""
echo "说明："
echo "  - 已清理错误的笔记数据"
echo "  - 同步模式暂时改为单向 (WebUI → Notion)"
echo "  - 双向同步功能需要进一步开发才能正常使用"
echo ""
echo "验证："
echo "  1. 打开 http://localhost:3000 检查 WebUI 笔记"
echo "  2. 运行 ai-sync 测试同步"
echo "========================================"
