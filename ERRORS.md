# 🐛 错误记录

> 记录开发过程中的错误，避免重复犯错

## 错误列表

### 1. 时区比较错误
- **日期**: 2026-02-17
- **位置**: `sync/sync_service.py` 双向同步
- **问题**: `TypeError: can't compare offset-naive and offset-aware datetimes`
- **原因**: Notion 时间戳带时区 (`+00:00`)，WebUI 时间戳不带时区
- **修复**: 统一转换为无时区时间再比较
```python
notion_time = dt.fromisoformat(timestamp.replace('Z', '+00:00'))
notion_time = notion_time.replace(tzinfo=None)  # 转为无时区
```

### 2. LM Studio Docker 路径问题
- **日期**: 2026-05-19
- **位置**: `sync/sync_service.py`
- **问题**: 硬编码 `host.docker.internal:1234`，Docker 外完全无法工作
- **修复**: 改为在 `config/notion.yaml` 的 `lm_studio.url` 中配置

### 3. ChromaDB 路径不一致
- **日期**: 2026-05-19
- **位置**: `sync/sync_service.py`
- **问题**: 有两个路径 `data/chroma_db/` 和 `data/vector-db/`，造成混乱
- **修复**: 统一使用 `data/vector-db/`（DIRECTORY_STRUCTURE.md 规范）
- **旧路径** `data/chroma_db/` 可手动删除

### 4. Flomo 标签多级处理
- **日期**: 2026-02-17
- **位置**: `scripts/flomo2notion.py`
- **问题**: 多级标签如 `#工作/2026/周报` 全部被删除
- **修复**: 只取第一级加到属性，全部内容保留

---

## 常见问题

### Q: 同步后向量库没有数据
**A**: 检查 `config/notion.yaml` 的 token 和 database ID 是否正确；确认 ChromaDB 路径有写入权限

### Q: LM Studio 模型列表为空
**A**: 确保 LM Studio 已启动并开启 "Advanced" → "API" 设置；确认 `lm_studio.url` 为 `http://localhost:1234/v1`

### Q: 标题生成失败
**A**: LM Studio 必须启动；如果用了非默认模型，确认模型已加载到 LM Studio

### Q: Docker 版和直接运行版混用
**A**: v3.0 之后不再使用 Docker 运行同步服务。如果之前用 Docker，请改用 `python3 sync/sync_service.py` 直接运行

---

## 重要提醒

1. **v3.0 不再使用 Docker** — 同步服务改为直接 `python3 sync/sync_service.py` 运行
2. **ChromaDB 统一路径** — `data/vector-db/` 是正式路径，旧 `data/chroma_db/` 可删除
3. **LM Studio 配置** — 在 `config/notion.yaml` 的 `lm_studio.url` 中配置，不再硬编码
4. **Notion API 频率限制** — 同步间隔不要太短（建议 3600 秒以上）
