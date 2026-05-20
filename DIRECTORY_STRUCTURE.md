# 📁 AI System 目录结构

## 完整目录

```
~/ai-system/
│
├── 📦 代码文件 (Git 跟踪)
│   ├── config/
│   │   └── notion.yaml         # 唯一配置文件
│   ├── sync/
│   │   └── sync_service.py     # 同步服务主程序（含 Web 监控）
│   ├── scripts/

│   ├── data/                    # 敏感数据（不上 Git）
│   ├── logs/                    # 日志（不上 Git）
│   ├── STATUS.md               # 项目状态
│   ├── DIRECTORY_STRUCTURE.md   # 本文档
│   └── ERRORS.md               # 错误记录
│
├── 🔒 敏感数据 (不上 Git)
│   └── data/
│       ├── vector-db/          # ChromaDB 向量数据库
│       ├── chroma_db/          # 旧版向量库（可删除）
│       ├── sync_state.json     # 同步映射和状态
│       ├── *.json              # 缓存和日志
│       └── webui.db            # WebUI 数据库
│
└── 📋 日志 (不上 Git)
    └── logs/
        └── sync.log            # 同步服务日志
```

## 向量数据库

**使用路径**: `~/ai-system/data/vector-db/`

| Collection | 内容 |
|------------|------|
| `knowledge` | 所有 Notion 页面内容（用于语义搜索）|

**旧路径**（可删除）: `data/chroma_db/`

## 配置文件说明

### config/notion.yaml

所有配置集中在这一文件：

```yaml
notion:
  token: "ntn_xxx"
  databases:
    复盘: "id"
    目标: "id"
    闪念: "id"
    AI笔记: "id"

lm_studio:
  url: "http://localhost:1234/v1"
  default_model: "qwen2.5:14b-instruct"

web:
  port: 5100

sync:
  interval: 3600   # 秒，0=禁用自动同步

review:
  auto_title: true
```

## Git 工作流

```bash
cd ~/ai-system

# 忽略敏感文件（已有 .gitignore）
git add .
git commit -m "update"
git push

# 如果之前误提交了敏感文件，从历史删除
git rm -r --cached data/
git rm -r --cached logs/
git commit -m "remove sensitive files"
```
