#!/bin/bash

echo "=== 1. 检查服务状态 ==="
docker ps --format "{{.Names}}: {{.Status}}"

echo -e "\n=== 2. 检查需求数据 ==="
docker exec tg-monitor python3 -c "
import sqlite3
conn = sqlite3.connect('/app/data/telegram.db')
cursor = conn.cursor()
cursor.execute('SELECT COUNT(*) FROM requirements WHERE source LIKE \"channel:%\"')
print(f'频道需求数: {cursor.fetchone()[0]}')
cursor.execute('SELECT id, source FROM requirements ORDER BY created_at DESC LIMIT 3')
for r in cursor.fetchall():
    print(f'  {r[0]}: {r[1]}')
conn.close()
"

echo -e "\n=== 3. 检查消息媒体类型 ==="
docker exec tg-monitor python3 -c "
import sqlite3
conn = sqlite3.connect('/app/data/telegram.db')
cursor = conn.cursor()
cursor.execute('SELECT media_type, COUNT(*) FROM messages WHERE media_type IS NOT NULL GROUP BY media_type')
for r in cursor.fetchall():
    print(f'  {r[0]}: {r[1]}条')
conn.close()
"

echo -e "\n=== 4. 检查前端版本 ==="
curl -s http://localhost:3001/ | grep "app.js" | head -1

echo -e "\n=== 5. 检查最新日志 ==="
echo "监听服务:"
docker logs tg-monitor --tail 5
echo -e "\nWeb 服务:"
docker logs tg-web --tail 5

echo -e "\n=== 诊断完成 ==="
