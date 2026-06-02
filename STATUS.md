# AI System 项目状态

> 最后更新: 2026-05-25

## ✅ 已完成

| 模块 | 功能 |
|------|------|
| Notion → 向量库同步 | 4 个数据库同步到 ChromaDB（knowledge collection） |
| 向量语义搜索 | 基于 ChromaDB，Dashboard 和 Search 页均可用 |
| AI 标题生成 | 无标题的闪念/复盘页面，调用 LM Studio 自动生成中文标题 |
| Web UI | Next.js，访问 http://localhost:3000（主入口） |
| 后台 Flask API | http://localhost:5100（后端，不直接访问） |
| 模型选择 | Web UI 侧边栏直接切换 LM Studio 已加载模型 |
| 后台自动同步 | 每 21600 秒（6 小时）自动同步一次 |
| AI 复盘自动总结 | 同步复盘库时自动生成 AI 摘要，存入向量库 metadata |
| ESC 关闭弹窗 | 所有弹窗（确认框、编辑框、新建框、模型下拉）均支持 ESC 键关闭 |
| 本地复盘 → 向量库同步 | 新建/修改/删除复盘实时同步到 ChromaDB；`POST /api/index_local_reviews` 可补全存量数据 |

## ⏳ 待开发

- [ ] 复盘总结写回 Notion 属性字段（当前只存本地）
- [ ] GitHub 项目代码分析（如需要再做）

## 🏗️ 系统架构

```
用户浏览器
    ↓ localhost:3000
Next.js Web UI
    ↓ fetch localhost:5100/api/*
Flask + ChromaDB (sync_service.py)
    ↓                    ↓
Notion API         LM Studio :1234
```

## 🔧 启动方式

```bash
# 后台常驻（推荐）
nohup python3 ~/ai-system/sync/sync_service.py >> ~/ai-system/logs/sync.log 2>&1 &

# Web UI
cd ~/ai-system/web && npm run dev

# 主入口
open http://localhost:3000
```

## 📌 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v3.3 | 2026-05-25 | 本地复盘实时同步到 ChromaDB，知识搜索页可检索 |
| v3.2 | 2026-05-25 | 全局 ESC 键关闭弹窗支持 |
| v3.1 | 2026-05-21 | 修复 Broken Pipe 崩溃；实现 AI 复盘自动总结；Claude Code 接手 |
| v3.0 | 2026-05-19 | 重构为后台服务 + Web 监控面板；移除 Docker |
| v2.0 | 2026-02-14 | AI 自动生成标题 |
| v1.0 | 2026-02-13 | 基础同步功能 |
