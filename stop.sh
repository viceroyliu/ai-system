#!/bin/bash
echo "🛑 停止 AI 系统..."
cd ~/ai-system
docker compose down
echo "✅ 已停止"
