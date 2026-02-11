# 🧠 第二大脑系统 - 项目状态

> 最后更新：2026-02-12
> 
> 这个文档用于记录项目的当前状态，方便在不同 AI 对话中快速同步上下文。

---

## 📋 项目概述

### 核心目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **个人成长助手** | 监测行为、分析复盘笔记、追踪目标、给出优化建议 | 🔴 高 |
| **代码助手** | 理解公司代码库、根据项目风格写代码、发现 bug | 🔴 高 |
| **工作自动化** | 监听 Telegram 工作群、理解需求、辅助完成重复性工作 | 🔴 高 |

### 硬件环境

- **设备**：Mac Mini M4 Pro
- **内存**：48GB
- **存储**：512GB
- **网络**：万兆网口
- **代理**：Surge HTTP 代理 (127.0.0.1:6152)

### 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| AI 模型 | Ollama + Qwen 2.5 14B | 本地运行，预留 API 切换接口 |
| 交互界面 | Open WebUI | 端口 3000 |
| 向量数据库 | ChromaDB | 本地持久化存储 |
| 消息监听 | Telethon (Telegram User API) | 通过代理连接 |
| 笔记系统 | Notion API | 复盘、目标、闪念、AI笔记 |
| 容器化 | Docker Compose | 统一管理所有服务 |

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户交互层                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ Open WebUI  │    │ TG Web UI   │    │ (未来)CLI   │         │
│  │ :3000       │    │ :3001       │    │             │         │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘         │
└─────────┼──────────────────┼───────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AI 处理层                                 │
│  ┌─────────────┐    ┌─────────────┐                            │
│  │ Ollama      │    │ Claude API  │  ← 预留，可随时切换         │
│  │ Qwen 14B    │    │ (备用)      │                            │
│  └──────┬──────┘    └─────────────┘                            │
└─────────┼───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        知识存储层                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ ChromaDB    │    │ SQLite      │    │ Notion      │         │
│  │ 向量索引     │    │ TG 消息     │    │ 笔记/复盘    │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
└─────────────────────────────────────────────────────────────────┘
          ▲                  ▲                  ▲
          │                  │                  │
┌─────────────────────────────────────────────────────────────────┐
│                        数据同步层                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ ai-sync     │    │ tg-monitor  │    │ (未来)      │         │
│  │ :5100       │    │ 实时监听     │    │ gitlab-sync │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 目录结构

```
~/ai-system/
├── config/                      # 配置文件
│   ├── notion.yaml             # Notion API 配置 ✅
│   └── telegram.yaml           # Telegram 配置 ✅
│
├── data/                        # 数据存储
│   ├── chroma_db/              # 向量数据库 ⚠️ 有问题
│   ├── telegram.db             # Telegram 消息 SQLite ✅
│   ├── telegram_images/        # TG 图片存储 ✅
│   ├── ai_monitor.session      # Telegram 登录会话 ✅
│   ├── sync_state.json         # 同步状态 ✅
│   ├── tg_status.json          # TG 连接状态 ✅
│   └── send_queue.json         # 待发送消息队列 ✅
│
├── sync/                        # 同步服务
│   ├── sync_service.py         # 主同步服务 ⚠️ 需要修复
│   ├── notion_sync.py          # Notion 同步（旧版）
│   └── Dockerfile              # 同步服务容器 ✅
│
├── telegram/                    # Telegram 模块
│   ├── tg_monitor.py           # 消息监听服务 ✅
│   ├── tg_local.py             # 本地调试版 ✅
│   ├── modules/
│   │   └── requirement_sync.py # 需求自动提取 ✅
│   └── web/
│       ├── server.py           # Flask Web 服务 ✅
│       ├── templates/
│       │   └── index.html      # 前端界面 ✅
│       └── backend/            # FastAPI 后端 ⚠️ 有 bug
│
├── scripts/                     # 工具脚本
│   └── flomo2notion.py         # Flomo 导入工具 ✅
│
├── logs/                        # 日志文件
│   ├── monitor.log             # TG 监听日志
│   ├── sync.log                # 同步日志
│   ├── backend.log             # 后端日志
│   └── ai-sync.log             # AI 同步日志
│
├── docker-compose.yml          # Docker 编排 ✅
├── start.sh                    # 启动脚本 ✅
└── stop.sh                     # 停止脚本 ✅
```

---

## ✅ 已完成功能

### 1. 基础架构
- [x] Docker Compose 配置
- [x] Open WebUI 部署 (端口 3000)
- [x] Ollama 本地模型 (Qwen 2.5 14B)
- [x] 启动/停止脚本

### 2. Notion 集成
- [x] Notion API 连接
- [x] 四个数据库配置（复盘、目标、闪念、AI笔记）
- [x] 双向同步逻辑（WebUI Notes ↔ Notion）
- [x] AI 自动生成标题
- [x] Flomo 导入工具

### 3. Telegram 集成
- [x] User API 登录（非 Bot）
- [x] 实时消息监听
- [x] 消息存储到 SQLite
- [x] 图片下载保存
- [x] 需求自动提取（特定群组）
- [x] 需求状态追踪（pending/done）
- [x] 消息发送功能
- [x] Web 管理界面 (端口 3001)
- [x] AI 辅助回复

### 4. 向量数据库
- [x] ChromaDB 集成
- [x] Notion 内容索引
- [x] 搜索 API

---

## ❌ 已知问题

### 🔴 严重问题

| 问题 | 文件 | 错误信息 | 状态 |
|------|------|----------|------|
| ChromaDB 损坏 | sync_service.py | `Error in compaction: Failed to apply logs` | 待修复 |
| Collection 不存在 | notion_sync.py | `Collection does not exist` | 待修复 |

### 🟡 一般问题

| 问题 | 文件 | 错误信息 | 状态 |
|------|------|----------|------|
| time 模块未导入 | backend/routers/messages.py | `NameError: name 'time' is not defined` | 待修复 |
| 图片 404 | backend | `/api/image/xxx` 返回 404 | 待排查 |
| 配置文件重复 | config/ | notion.yaml 和 telegram.yaml 都有 Notion 配置 | 待统一 |

### 🟢 小问题

| 问题 | 说明 | 状态 |
|------|------|------|
| 代理断开 | Surge 代理关闭时 TG 监听会断开 | 已知，重启即可 |
| 端口冲突 | 5100 端口有时被占用 | 已知，kill 进程即可 |

---

## 🚧 待开发功能

### 阶段 3：GitLab 集成（下一步）

- [ ] GitLab API 连接
- [ ] 代码库克隆/拉取
- [ ] 代码文件索引到向量库
- [ ] 代码风格分析
- [ ] 基于上下文的代码建议

### 阶段 4：智能自动化

- [ ] Telegram 需求 → 自动关联代码变更
- [ ] AI 分析需求 → 生成代码修改建议
- [ ] 代码提交 → 自动回复 Telegram

### 阶段 5：个人成长分析

- [ ] 复盘数据分析
- [ ] 目标进度追踪
- [ ] 习惯养成提醒
- [ ] 周/月总结生成

---

## 🔧 配置说明

### Notion 数据库 ID

```yaml
# config/notion.yaml
databases:
  复盘: "2edfd8a80a7980b19dd9c11447764b33"
  目标: "2edfd8a80a7980d78eb5ca3b9a112d19"
  闪念: "2edfd8a80a79803bb751e98692eff8a3"
  AI笔记: "2edfd8a80a798074bbb6fa89d8ddd99e"
```

### Telegram 需求频道

```python
# telegram/modules/requirement_sync.py
REQUIREMENT_CHANNELS = {
    2333658668: {
        'name': '股票需求发布',
        'auto_create': True,
        'auto_done_keywords': ['已处理', '完成', 'done']
    }
}
```

### Docker 服务

| 服务 | 容器名 | 端口 | 说明 |
|------|--------|------|------|
| open-webui | open-webui | 3000 | AI 对话界面 |
| tg-monitor | tg-monitor | - | Telegram 监听 |
| tg-web | tg-web | 3001 | TG 消息管理 |
| ai-sync | ai-sync | 5100 | 同步服务 |

---

## 📝 重要决策记录

### 为什么选择 ChromaDB？
- 本地运行，数据不外泄
- Python 原生支持
- 轻量级，适合个人使用
- 可导出迁移

### 为什么用 Telegram User API 而不是 Bot？
- Bot 无法加入某些群组
- Bot 无法读取历史消息
- User API 权限更完整

### 为什么预留 Claude API 接口？
- 本地模型能力有限
- 复杂任务可能需要更强的模型
- 统一记忆层设计，切换无感

---

## 🚀 快速命令

```bash
# 启动系统
cd ~/ai-system && ./start.sh

# 停止系统
cd ~/ai-system && ./stop.sh

# 查看日志
tail -f ~/ai-system/logs/monitor.log
tail -f ~/ai-system/logs/sync.log

# 手动触发同步
curl -X POST http://localhost:5100/sync

# 搜索知识库
curl -X POST http://localhost:5100/search \
  -H "Content-Type: application/json" \
  -d '{"query": "搜索关键词", "limit": 5}'

# 本地运行 Telegram（调试用）
cd ~/ai-system && python3 telegram/tg_local.py
```

---

## 📅 更新日志

### 2026-02-12
- 创建项目状态文档

### 2026-02-01
- Telegram 监听服务完善
- 需求自动提取功能
- Web 管理界面上线

### 2026-01 早期
- 项目初始化
- Open WebUI + Ollama 部署
- Notion 同步基础功能
- ChromaDB 集成

---

## 💡 下次对话提示

如果你在新的 AI 对话中继续这个项目，请：

1. 上传这个 `STATUS.md` 文件
2. 说明你要处理的具体问题
3. 如果有错误，附上相关日志

示例开场白：
> 我在继续开发"第二大脑"项目。请先阅读 STATUS.md 了解项目状态。
> 我现在需要 [修复 ChromaDB 问题 / 添加 GitLab 集成 / ...]
