#!/bin/bash

# AI System Startup Script

cd /Users/viceroy/ai-system

# Start Flask
nohup python3 sync/sync_service.py > logs/flask.log 2> logs/flask.err &
FLASK_PID=$!
echo $FLASK_PID > logs/flask.pid

# Start Next.js
cd web
nohup npm run dev > ../logs/nextjs.log 2> ../logs/nextjs.err &
NEXT_PID=$!
echo $NEXT_PID > ../logs/nextjs.pid

echo "Services started: Flask PID=$FLASK_PID, Next.js PID=$NEXT_PID"