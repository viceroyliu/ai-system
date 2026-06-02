# 错误记录

> 记录开发中遇到的问题，避免重复犯同样的错

---

## 已修复

### [2026-05-21] Broken Pipe 导致同步假失败
- **位置**: `sync/sync_service.py` → `log()` 函数
- **现象**: `/api/status` 返回 `last_error: "[Errno 32] Broken pipe"`，但同步日志显示正常完成
- **根因**: `log()` 里 `print(line, flush=True)` 没有包在 try-except 里。用 nohup 后台运行时终端关闭，stdout 管道断开，`print()` 抛出 `BrokenPipeError`，异常向上传播被 `sync_loop` 的 `except Exception` 捕获，覆盖了成功的 `_last_sync_result`
- **修复**: `print()` 包在 `try-except OSError` 里，并加了 `sync_lock` 防止手动触发和后台线程并发同步
- **教训**: `print(flush=True)` 在 nohup 后台场景下不安全，必须包住

### [2026-02-17] 时区比较错误
- **位置**: 双向同步逻辑
- **问题**: `TypeError: can't compare offset-naive and offset-aware datetimes`
- **修复**: `dt.replace(tzinfo=None)` 统一转 naive datetime

### [2026-05-19] ChromaDB 路径不一致
- **问题**: `data/chroma_db/` 和 `data/vector-db/` 并存，数据分散
- **修复**: 统一使用 `data/vector-db/`，旧路径已废弃

---

## 常见陷阱

### Q: 同步后 last_error 显示 Broken Pipe，但日志显示成功
**A**: 这是假报错。实际同步已完成，只是 `_last_sync_result` 被一次失败的手动同步覆盖了。已修复（v3.1）

### Q: LM Studio 模型列表为空
**A**: 确保 LM Studio 已启动并开启 API；`config/notion.yaml` 的 `lm_studio.url` 必须是 `http://localhost:1234/v1`

### Q: 标题生成失败 / 总结生成失败
**A**: LM Studio 必须有模型已加载（非仅启动程序）；检查 `/api/models` 返回是否有模型

### Q: Docker 版本遗留问题
**A**: v3.0 之后不再用 Docker，直接 `python3 sync/sync_service.py`

---

## 重要提醒

1. **主入口是 `localhost:3000`**，不是 `localhost:5100`
2. **nohup 启动时**用 `>> logs/sync.log 2>&1`，不要用管道
3. **ChromaDB 路径**统一 `data/vector-db/`，`data/chroma_db/` 是旧版可删
4. **Notion API 频率限制**：同步间隔不要低于 3600 秒
