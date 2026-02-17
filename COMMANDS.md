# AI System 常用指令

> 添加到 ~/.zshrc 后运行 `source ~/.zshrc`

## 完整指令列表

```bash
# === AI System 服务管理 ===
alias ai-up='cd ~/ai-system && docker compose up -d'
alias ai-down='cd ~/ai-system && docker compose down'
alias ai-restart='cd ~/ai-system && docker compose restart'
alias ai-logs='docker logs ai-sync -f --tail 50'
alias ai-sync='curl -s -X POST http://localhost:5100/sync > /dev/null & sleep 1 && docker logs ai-sync --tail 30 -f'
alias ai-status='curl -s http://localhost:5100/status | python3 -m json.tool'

# === Open WebUI ===
alias webui-update='docker pull ghcr.io/open-webui/open-webui:main && cd ~/ai-system && docker compose down && docker compose up -d'
alias webui-logs='docker logs open-webui -f --tail 50'

# === Telegram ===
alias tg-logs='docker logs tg-monitor -f --tail 50'
alias tg-web='open http://localhost:3001'

# === 快捷访问 ===
alias ai-web='open http://localhost:3000'
alias ai-config='code ~/ai-system/config/notion.yaml'
alias ai-code='code ~/ai-system'
```

## 一键添加到 .zshrc

```bash
cat >> ~/.zshrc << 'EOF'

# === AI System 服务管理 ===
alias ai-up='cd ~/ai-system && docker compose up -d'
alias ai-down='cd ~/ai-system && docker compose down'
alias ai-restart='cd ~/ai-system && docker compose restart'
alias ai-logs='docker logs ai-sync -f --tail 50'
alias ai-sync='curl -s -X POST http://localhost:5100/sync > /dev/null & sleep 1 && docker logs ai-sync --tail 30 -f'
alias ai-status='curl -s http://localhost:5100/status | python3 -m json.tool'

# === Open WebUI ===
alias webui-update='docker pull ghcr.io/open-webui/open-webui:main && cd ~/ai-system && docker compose down && docker compose up -d'
alias webui-logs='docker logs open-webui -f --tail 50'

# === Telegram ===
alias tg-logs='docker logs tg-monitor -f --tail 50'
alias tg-web='open http://localhost:3001'

# === 快捷访问 ===
alias ai-web='open http://localhost:3000'
alias ai-config='code ~/ai-system/config/notion.yaml'
alias ai-code='code ~/ai-system'
EOF

source ~/.zshrc
```

## 常用操作

| 操作 | 命令 |
|------|------|
| 启动服务 | `ai-up` |
| 停止服务 | `ai-down` |
| 重启服务 | `ai-restart` |
| 查看同步日志 | `ai-logs` |
| 手动同步 | `ai-sync` |
| 查看状态 | `ai-status` |
| 更新 WebUI | `webui-update` |
| 打开 WebUI | `ai-web` |
| 打开 TG 消息 | `tg-web` |
| 编辑配置 | `ai-config` |

## 故障排查

```bash
# 查看所有容器状态
docker ps -a

# 查看某个服务日志
docker logs ai-sync --tail 100
docker logs open-webui --tail 100
docker logs tg-monitor --tail 100

# 重建某个服务
docker compose up -d --force-recreate ai-sync

# 清理并重建
ai-down && docker compose up -d --build

# 查看同步状态文件
cat ~/ai-system/data/sync_state.json | python3 -m json.tool

# 重置同步状态（强制全量同步）
rm ~/ai-system/data/sync_state.json && docker restart ai-sync
```
