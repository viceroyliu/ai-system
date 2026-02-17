# AI System 项目状态

> 最后更新: 2026-02-17

## 🎯 项目目标

1. **AI 监测行为** - 通过 AI 监测每日复盘、笔记和目标，提供具体指导
2. **GitLab 代码辅助** - 让 AI 根据公司项目代码，帮助写代码和优化
3. **Telegram 集成** - 连接工作群，AI 自动根据消息帮助完成工作

## 📊 当前进度

### ✅ 已完成

| 模块 | 功能 | 状态 |
|------|------|------|
| **基础架构** | Docker Compose 部署 | ✅ |
| **Open WebUI** | 本地 AI 对话界面 | ✅ |
| **Notion 同步** | 双向同步（新增/修改/删除） | ✅ |
| **向量数据库** | ChromaDB 知识库 | ✅ |
| **复盘自动总结** | AI 生成复盘摘要 | ✅ |
| **笔记分类** | 【分类】标题 格式解析 | ✅ |
| **增量同步** | 只同步变化的内容 | ✅ |
| **Telegram 监控** | 消息抓取和存储 | ✅ |
| **Telegram Web** | 查看消息界面 | ✅ |

### 🚧 进行中

| 模块 | 功能 | 状态 |
|------|------|------|
| **Telegram AI** | 消息分析和自动回复 | 🚧 |
| **GitLab 集成** | 代码库接入 | ⏳ |

### ⏳ 待开发

- [ ] GitLab 项目代码分析
- [ ] Telegram 自动任务执行
- [ ] API 切换（本地 ↔ 线上）
- [ ] 定时同步任务

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        AI System                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │  Open WebUI  │   │  Telegram    │   │   Notion     │    │
│  │   :3000      │   │  Monitor     │   │   Sync       │    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘    │
│         │                  │                   │            │
│         ▼                  ▼                   ▼            │
│  ┌──────────────────────────────────────────────────┐      │
│  │              Ollama (本地 AI)                     │      │
│  │              host.docker.internal:11434          │      │
│  └──────────────────────────────────────────────────┘      │
│         │                  │                   │            │
│         ▼                  ▼                   ▼            │
│  ┌──────────────────────────────────────────────────┐      │
│  │           ChromaDB (向量数据库)                   │      │
│  │           data/vector-db                         │      │
│  └──────────────────────────────────────────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 📁 目录结构

```
~/ai-system/
├── docker-compose.yml      # 服务编排
├── config/
│   └── notion.yaml         # Notion 配置
├── data/
│   ├── vector-db/          # ChromaDB 数据
│   ├── sync_state.json     # 同步状态
│   └── telegram/           # Telegram 数据
├── sync/
│   └── sync_service.py     # 同步服务 v2.4
└── telegram/
    ├── tg_monitor.py       # Telegram 监控
    └── web/
        └── server.py       # Web 界面
```

## 🔧 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Open WebUI | 3000 | AI 对话界面 |
| Telegram Web | 3001 | 消息查看 |
| Sync Service | 5100 | 同步 API |
| Ollama | 11434 | 本地 AI |

## 📝 Notion 数据库

| 数据库 | 用途 |
|--------|------|
| 复盘 | 每日复盘，自动生成 AI 总结 |
| 目标 | 目标管理 |
| 闪念 | 随时记录的想法 |
| AI笔记 | WebUI 笔记同步 |

## 🔄 同步模式

在 `config/notion.yaml` 中配置：

```yaml
notes:
  flow: bidirectional  # 可选: webui_to_notion, notion_to_webui, bidirectional
```

| 模式 | 方向 | 说明 |
|------|------|------|
| webui_to_notion | WebUI → Notion | 单向同步到 Notion |
| notion_to_webui | Notion → WebUI | 单向同步到 WebUI |
| bidirectional | 双向 | 自动检测变化，冲突时以更新时间为准 |

## 🛠️ 常用命令

```bash
# 服务管理
ai-up              # 启动所有服务
ai-down            # 停止所有服务
ai-logs            # 查看同步日志
ai-sync            # 手动触发同步
ai-status          # 查看同步状态

# WebUI 更新
webui-update       # 更新 Open WebUI 到最新版

# Telegram
tg-logs            # 查看 Telegram 日志
tg-web             # 打开 Telegram Web 界面
```

## 📋 配置文件

### config/notion.yaml

```yaml
notion:
  token: "ntn_xxx"  # Notion API Token
  databases:
    复盘: "xxx"
    目标: "xxx"
    闪念: "xxx"
    AI笔记: "xxx"

ai:
  model: "qwen2.5:14b-instruct"

sync:
  interval: 3600

review:
  auto_summary: true
  auto_title: true

notes:
  flow: "bidirectional"
```

## 🔗 相关链接

- [Notion 工作区](https://www.notion.so/AI-2edfd8a80a7980bba9b0f9b719950ab6)
- [AI 指令文档](https://www.notion.so/AI-2eefd8a80a7980b1bff0e307c4cda453)

## 📌 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v2.4 | 2026-02-17 | 双向同步修复，冲突按时间解决 |
| v2.3 | 2026-02-16 | 完整同步（新增/修改/删除） |
| v2.2 | 2026-02-16 | WebUI 笔记更新检测 |
| v2.1 | 2026-02-14 | 增量同步优化 |
| v2.0 | 2026-02-14 | 复盘自动总结，分类解析 |
| v1.0 | 2026-02-13 | 基础同步功能 |
