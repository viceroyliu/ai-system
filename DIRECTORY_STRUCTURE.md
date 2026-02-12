# 📁 AI System 目录结构规范

## 目录分类

```
~/ai-system/
│
├── 📦 代码文件 (需要 Git 跟踪)
│   ├── config/              # 配置文件模板
│   ├── sync/                # 同步服务代码
│   ├── telegram/            # Telegram 模块代码
│   ├── scripts/             # 工具脚本
│   ├── docker-compose.yml   # Docker 编排
│   ├── start.sh             # 启动脚本
│   ├── stop.sh              # 停止脚本
│   ├── cleanup.sh           # 清理脚本
│   ├── check_system.sh      # 诊断脚本
│   ├── STATUS.md            # 项目状态
│   └── README.md            # 项目说明
│
├── 🔒 敏感数据 (不要上传 Git)
│   └── data/
│       ├── vector-db/       # 向量数据库 (统一使用这个)
│       ├── telegram.db      # Telegram 消息数据库
│       ├── telegram_images/ # Telegram 图片
│       ├── *.session        # Telegram 登录凭证
│       ├── sync_state.json  # 同步状态
│       └── tg_status.json   # TG 连接状态
│
├── 📋 日志 (不要上传 Git)
│   └── logs/
│       ├── monitor.log      # TG 监听日志
│       ├── sync.log         # 同步日志
│       └── web.log          # Web 服务日志
│
└── 🐍 Python 环境 (不要上传 Git)
    └── venv/                # 虚拟环境
```

## 向量数据库统一规范

**统一使用**: `~/ai-system/data/vector-db/`

| Collection 名称 | 内容 | 说明 |
|----------------|------|------|
| `notion_knowledge` | 博客笔记 + Notion 数据 | 所有知识库内容 |

**废弃的路径** (应删除):
- `cache/chroma/` - 空目录，已废弃
- `data/chroma_db/` - 如果存在，需要迁移或删除

## 配置文件说明

### config/notion.yaml
```yaml
notion:
  token: "your-token"  # Notion API Token
  databases:
    复盘: "database-id"
    目标: "database-id"
    闪念: "database-id"
    AI笔记: "database-id"

ai:
  model: "qwen2.5:14b-instruct"

sync:
  interval: 3600

notes:
  flow: "bidirectional"
```

### config/telegram.yaml
```yaml
telegram:
  api_id: 12345
  api_hash: "your-hash"
  proxy:
    type: "http"
    host: "127.0.0.1"
    port: 6152
```

## Git 工作流

```bash
# 首次设置
cp .gitignore ~/ai-system/
cd ~/ai-system
git add .gitignore

# 日常提交 (自动忽略敏感文件)
git add .
git commit -m "your message"
git push

# 如果之前已经提交了敏感文件，需要从历史中删除
git rm -r --cached data/
git rm -r --cached venv/
git rm -r --cached logs/
git rm --cached *.session
git commit -m "Remove sensitive files from tracking"
```

## 新环境部署

```bash
# 1. 克隆代码
git clone https://github.com/viceroyliu/ai-system.git
cd ai-system

# 2. 创建必要目录
mkdir -p data logs

# 3. 创建虚拟环境
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt  # 如果有的话

# 4. 复制配置文件并填入真实值
cp config/notion.yaml.example config/notion.yaml
cp config/telegram.yaml.example config/telegram.yaml
# 编辑配置文件...

# 5. 启动服务
./start.sh
```
