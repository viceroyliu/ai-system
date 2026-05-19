# AI System 项目状态

> 最后更新: 2026-05-19

## 🎯 项目目标

1. **Notion 知识库同步** — 将 Notion 笔记同步到本地向量数据库，支持 AI 搜索
2. **AI 标题生成** — 自动为无标题的复盘/闪念页面生成中文标题
3. **本地模型支持** — 支持 LM Studio / Ollama 等本地 AI 模型
4. **Web 监控面板** — 实时查看同步状态、向量库情况、模型选择

## ✅ 已完成

| 模块 | 功能 | 状态 |
|------|------|------|
| **Notion → 向量库同步** | Notion 4 个数据库同步到 ChromaDB | ✅ |
| **向量搜索** | 基于 ChromaDB 的语义搜索 | ✅ |
| **AI 标题生成** | 调用 LM Studio API 生成无标题页面的标题 | ✅ |
| **Web 监控面板** | http://localhost:5100 实时状态 | ✅ |
| **后台服务** | Python 直接运行（不再用 Docker），支持自动同步 | ✅ |
| **模型选择** | 在 Web UI 中直接选择 LM Studio 模型 | ✅ |
| **Flomo 导入** | 将 Flomo 导出的 HTML 批量导入 Notion 闪念 | ✅ |

## 🚧 进行中

| 模块 | 功能 | 状态 |
|------|------|------|
| **WebUI ↔ Notion 双向同步** | 笔记的双向同步和冲突处理 | ⏳ |
| **AI 自动总结** | 复盘页面自动生成摘要 | ⏳ |

## ⏳ 待开发

- [ ] WebUI ↔ Notion 双向同步
- [ ] AI 复盘自动总结
- [ ] GitHub 项目代码分析（参考项目结构上传 GitHub，供 AI 读取进度）

## 🏗️ 系统架构

```
┌──────────────────────────────────────────────┐
│              AI System                        │
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────────────┐   ┌──────────────────┐    │
│  │ 监控面板     │   │  Flomo 导入脚本  │    │
│  │ localhost   │   │ scripts/flomo2   │    │
│  │ :5100       │   │ notion.py        │    │
│  └──────┬───────┘   └────────┬─────────┘    │
│         │                     │               │
│         ▼                     ▼               │
│  ┌──────────────────────────────────────┐    │
│  │      同步服务 sync_service.py          │    │
│  │      (Flask + ChromaDB + LM Studio)   │    │
│  └──────────────┬───────────────────────┘    │
│                 │                             │
│         ┌───────┴────────┐                   │
│         ▼                ▼                   │
│  ┌──────────────┐ ┌──────────────────┐       │
│  │  ChromaDB    │ │  Notion API       │       │
│  │  (向量库)    │ │  (数据源)         │       │
│  └──────────────┘ └──────────────────┘       │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │       LM Studio / Ollama             │    │
│  │       (本地 AI，生成标题)             │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 📁 目录结构

```
~/ai-system/
├── config/
│   └── notion.yaml          # 全部配置（Notion / LM Studio / 同步间隔）
├── data/
│   ├── vector-db/            # ChromaDB 向量数据库（正式的）
│   ├── chroma_db/            # 旧版向量库，可删除
│   ├── sync_state.json      # 同步状态（映射表、时间戳）
│   └── *.log/*.json         # 各种缓存和日志
├── sync/
│   └── sync_service.py      # 同步服务（主程序）
├── scripts/
│   └── flomo2notion.py      # Flomo HTML → Notion 导入
└── logs/
    └── sync.log             # 同步服务日志
```

## 🔧 启动方式

```bash
# 直接运行（后台常驻）
cd ~/ai-system
python3 sync/sync_service.py

# 或用 nohup 后台运行
nohup python3 ~/ai-system/sync/sync_service.py > ~/ai-system/logs/sync.log 2>&1 &

# 查看日志
tail -f ~/ai-system/logs/sync.log
```

**启动后访问**: http://localhost:5100

## 📋 配置说明（config/notion.yaml）

```yaml
notion:
  token: "ntn_xxx"
  databases:
    复盘: "database-id"
    目标: "database-id"
    闪念: "database-id"
    AI笔记: "database-id"

lm_studio:
  url: "http://localhost:1234/v1"      # LM Studio 地址
  default_model: "qwen2.5:14b-instruct"  # 默认模型

web:
  port: 5100                            # 监控面板端口

sync:
  interval: 3600                        # 自动同步间隔（秒），0=禁用

review:
  auto_title: true                      # 自动生成标题
  auto_title_model: null                # 指定模型，null=用 default_model
```

## 🔄 ChromaDB 向量库

**路径**: `~/ai-system/data/vector-db/`

**Collection**: `knowledge`

**用途**:
- Notion 页面内容存入向量库
- 搜索时直接查 ChromaDB（不查 Notion API），速度快，支持语义搜索
- LM Studio 生成标题时调用本地模型

## 📌 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v3.0 | 2026-05-19 | 重构为后台服务 + Web 监控面板；支持 LM Studio 模型选择；移除 Docker |
| v2.4 | 2026-02-17 | 双向同步修复，冲突按时间解决 |
| v2.0 | 2026-02-14 | AI 自动生成标题，分类解析 |
| v1.0 | 2026-02-13 | 基础同步功能 |
