#!/bin/bash
echo "🚀 启动 AI 系统..."

# 启动 Ollama
if ! pgrep -x ollama > /dev/null; then
    echo "启动 Ollama..."
    ollama serve > /dev/null 2>&1 &
    sleep 3
fi

# 启动 Docker 服务
cd ~/ai-system
docker compose up -d

echo ""
echo "⏳ 等待服务启动..."
sleep 15

echo ""
echo "✅ 系统已启动！"
echo ""
echo "📱 访问地址:"
echo "   - AI 对话: http://localhost:3000"
echo "   - TG 消息: http://localhost:3001"
