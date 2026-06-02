# AI System 需求文档

> 维护者: Claude Code（接手自 MiniMax M2.7，2026-05-21）

---

## 用户信息

- **设备**: Mac mini Pro，48GB RAM，macOS
- **语言**: 中英混合
- **本地 AI**: LM Studio（非 Ollama）
- **风格**: 直接，快速测试，不废话
- **UI 标准高**: 不用原生 prompt()/alert()，需要自定义 Modal

---

## 核心需求

### 1. Notion 知识库同步
- Notion 4 个数据库（复盘、目标、闪念、AI笔记）→ 本地 ChromaDB
- 支持全量同步和自动定时同步（默认 6 小时）
- AI 自动为无标题的闪念/复盘页面生成中文标题（≤10字）

### 2. AI 语义搜索
- 基于 ChromaDB 向量库做语义搜索
- 在 Dashboard 和 Search 页均可搜索

### 3. AI 对话
- 基于知识库上下文回答问题（RAG 模式）
- 调用本地 LM Studio 模型
- Chat 页面支持多轮对话，显示引用来源

### 4. AI 复盘自动总结
- 同步复盘库时，对有内容的页面自动生成摘要（≤100字）
- 摘要存入 ChromaDB metadata 字段 `summary`
- 日历页 Calendar 显示复盘摘要

### 5. Web UI（localhost:3000 主入口）
- Dashboard：统计概览 + AI 搜索入口 + 可拖拽模块
- Chat：AI 多轮对话
- Search：语义搜索
- Calendar：日历 + 复盘记录
- Settings：模型/Notion/同步配置

#### UI 自适应规范（必须遵守）
做**自适应布局**时，不能只让外框（容器）随视口缩放，**内部内容也必须同步自适应**，包括但不限于：
- 卡片/模块内的字号、内边距、图标尺寸
- 列表项、图表、子卡片的高度与间距
- 网格子项（如「洞察视角」小卡）应使用 `clamp()` / 容器查询（container query）等方式随父模块高度缩放

**反例**：外层模块变高了，内部子卡片仍保持固定像素尺寸 → 视觉突兀、浪费空间。  
**正例**：外层模块变高时，内部洞察卡、图表绘图区、列表可视条数等一起放大或填充。

---

## 技术约束

- Web 前端: Next.js + React 19 + Tailwind v4（CSS-first）
- 后端: Python Flask（sync_service.py），端口 5100
- 向量库: ChromaDB，collection = `knowledge`，路径 `data/vector-db/`
- 本地 AI: LM Studio `http://localhost:1234/v1`（OpenAI-compatible）
- 配置文件: `config/notion.yaml`（唯一配置入口）
- 不使用 Docker

---

## 已废弃/不需要

- Flomo 导入（用户不再使用 Flomo）
- WebUI ↔ Notion 双向同步（已删除需求）
- GitHub 项目代码分析（可选，暂缓）
