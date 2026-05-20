"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type AppSettings } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [lmUrl, setLmUrl] = useState("http://localhost:1234/v1");
  const [defaultModel, setDefaultModel] = useState("");
  const [dbEntries, setDbEntries] = useState<Array<{ name: string; id: string }>>([]);
  const [newDbName, setNewDbName] = useState("");
  const [newDbId, setNewDbId] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncingInterval, setSyncingInterval] = useState(3600);
  const [autoTitle, setAutoTitle] = useState(true);
  const [currentModel, setCurrentModel] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiClient.getSettings();
      setSettings(s);
      setLmUrl(s.lm_studio?.url || "http://localhost:1234/v1");
      setDefaultModel(s.lm_studio?.default_model || "");
      setCurrentModel(s.lm_studio?.default_model || "");
      setSyncingInterval(s.sync?.interval || 3600);
      setAutoTitle(s.sync?.auto_title ?? true);
      const raw = s.notion?.databases || {};
      const entries: Array<{ name: string; id: string }> = [];
      for (const [name, val] of Object.entries(raw)) {
        const v = val as { id?: string; name?: string } | string;
        entries.push({ name, id: typeof v === 'string' ? v : (v.id || '') });
      }
      setDbEntries(entries);
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  async function handleSave() {
    setSaveError("");
    try {
      const dbs: Record<string, { id: string; name: string }> = {};
      for (const entry of dbEntries) {
        if (entry.name.trim() && entry.id.trim()) {
          dbs[entry.name.trim()] = { id: entry.id.trim(), name: entry.name.trim() };
        }
      }
      await apiClient.saveSettings({
        notion_databases: dbs,
        lm_studio: { url: lmUrl, default_model: defaultModel },
        sync: { interval: syncingInterval, auto_title: autoTitle },
      } as Partial<AppSettings> & { notion_databases?: Record<string, { id: string; name: string }>; lm_studio?: { url: string; default_model: string }; sync?: { interval: number; auto_title: boolean } });
      // 更新当前模型
      if (defaultModel) {
        await apiClient.setModel(defaultModel);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  function addDb() {
    if (newDbName.trim() && newDbId.trim()) {
      setDbEntries(prev => [...prev, { name: newDbName.trim(), id: newDbId.trim() }]);
      setNewDbName("");
      setNewDbId("");
    }
  }

  function removeDb(idx: number) {
    setDbEntries(prev => prev.filter((_, i) => i !== idx));
  }

  function intervalLabel(s: number) {
    if (s <= 0) return "禁用";
    if (s < 60) return `${s} 秒`;
    if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
    return `${Math.floor(s / 3600)} 小时`;
  }

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark"><span>NX</span></div>
          <div><div className="logo-text">Nexus</div><div className="logo-sub">AI System · v3.1</div></div>
        </div>
        <div className="search-box" onClick={() => router.push("/search")}><span>🔍 搜索知识库...</span><span className="key">⌘K</span></div>
        <div className="nav-section">
          <div className="nav-label">Main</div>
          <div className="nav-item" onClick={() => router.push("/")}><span>🏠</span> 概览</div>
          <div className="nav-item" onClick={() => router.push("/chat")}><span>💬</span> AI 对话</div>
          <div className="nav-item" onClick={() => router.push("/search")}><span>🔍</span> 搜索</div>
          <div className="nav-item active" onClick={() => router.push("/settings")}><span>⚙️</span> 设置</div>
        </div>
        <div className="nav-section">
          <div className="nav-label">数据源</div>
          <div className="nav-item"><span>🗂️</span> Notion<span className="nav-dot green"></span></div>
          <div className="nav-item"><span>📁</span> 本地笔记<span className="nav-dot green"></span></div>
        </div>
        <div className="sidebar-footer">
          <div className="model-select-label">当前模型</div>
          <select className="model-select" value={currentModel} onChange={async e => { try { await apiClient.setModel(e.target.value); setCurrentModel(e.target.value); } catch {} }}>
            <option value="">选择模型...</option>
            <option value="qwen2.5:14b-instruct">qwen2.5:14b-instruct</option>
            <option value="qwen3:14b">qwen3:14b</option>
            <option value="qwen3:32b">qwen3:32b</option>
            <option value="deepseek-coder:33b">deepseek-coder:33b</option>
          </select>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <h1>⚙️ 设置</h1>
            <div className="subtitle">修改配置后保存将自动更新 notion.yaml 并重启相关服务</div>
          </div>
          <div className="topbar-right">
            <button className="btn-primary" onClick={handleSave} disabled={loading}>
              {saved ? "✓ 已保存" : "💾 保存设置"}
            </button>
          </div>
        </div>

        <div className="content">
          {saveError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#b91c1c" }}>
              保存失败: {saveError}
            </div>
          )}

          <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* LM Studio Config */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🤖 模型配置</span>
                <span className="badge blue">LM Studio</span>
              </div>
              <div className="card-body">
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>API 地址</div>
                  <input type="text" value={lmUrl} onChange={e => setLmUrl(e.target.value)}
                    style={{ width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "var(--sb-text)", fontFamily: "inherit", outline: "none" }}
                    placeholder="http://localhost:1234/v1" />
                  <div style={{ fontSize: 10, color: "var(--sb-text-muted)", marginTop: 4 }}>LM Studio 的 OpenAI-compatible API 地址（Server → API Server → 确认端口为 1234）</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>默认模型</div>
                  <select className="model-select" value={defaultModel} onChange={e => setDefaultModel(e.target.value)} style={{ width: "100%" }}>
                    <option value="">选择模型...</option>
                    <option value="qwen2.5:14b-instruct">qwen2.5:14b-instruct</option>
                    <option value="qwen3:14b">qwen3:14b</option>
                    <option value="qwen3:32b">qwen3:32b</option>
                    <option value="deepseek-coder:33b">deepseek-coder:33b</option>
                  </select>
                  <div style={{ fontSize: 10, color: "var(--sb-text-muted)", marginTop: 4 }}>当前: {currentModel || "未选择"} · 在 LM Studio 中加载对应模型后生效</div>
                </div>
              </div>
            </div>

            {/* Notion Databases */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🗂️ Notion 数据库配置</span>
                <span className="badge green">已连接</span>
              </div>
              <div className="card-body">
                <div style={{ fontSize: 11, color: "var(--sb-text-muted)", marginBottom: 12 }}>
                  当前 token: <code style={{ background: "var(--sb-muted)", padding: "1px 4px", borderRadius: 3 }}>{settings?.notion?.token || "****"}</code>
                  &nbsp;·&nbsp;修改数据库配置会立即同步更新
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {dbEntries.map((db, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="text" value={db.name} onChange={e => setDbEntries(prev => prev.map((d, i) => i === idx ? { ...d, name: e.target.value } : d))}
                        placeholder="数据库名称" style={{ flex: 1, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                      <input type="text" value={db.id} onChange={e => setDbEntries(prev => prev.map((d, i) => i === idx ? { ...d, id: e.target.value } : d))}
                        placeholder="数据库 ID" style={{ flex: 2, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                      <button onClick={() => removeDb(idx)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#ef4444", padding: "4px 6px" }}>✕</button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <input type="text" value={newDbName} onChange={e => setNewDbName(e.target.value)} placeholder="新数据库名称"
                      style={{ width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                  </div>
                  <div style={{ flex: 2 }}>
                    <input type="text" value={newDbId} onChange={e => setNewDbId(e.target.value)} placeholder="Notion Database ID（32位）"
                      style={{ width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                  </div>
                  <button onClick={addDb} className="btn-ghost" style={{ fontSize: 11, padding: "7px 12px", whiteSpace: "nowrap" }}>+ 添加</button>
                </div>

                <div style={{ marginTop: 12, padding: "10px", background: "var(--sb-muted)", borderRadius: 8, fontSize: 11, color: "var(--sb-text-muted)" }}>
                  💡 Database ID 在 Notion 页面 URL 中获取：<code style={{ background: "var(--sb-border)", padding: "1px 4px", borderRadius: 3 }}>notion.so/{'{用户名}'}/{'{数据库名}'}-[这里32位ID]</code>
                </div>
              </div>
            </div>

            {/* Sync Settings */}
            <div className="card">
              <div className="card-header"><span className="card-title">🔄 同步设置</span></div>
              <div className="card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>自动同步</div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>自动同步间隔：{intervalLabel(syncingInterval)}</div>
                  </div>
                  <select value={syncingInterval} onChange={e => setSyncingInterval(Number(e.target.value))}
                    style={{ background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                    <option value={0}>禁用</option>
                    <option value={300}>5 分钟</option>
                    <option value={900}>15 分钟</option>
                    <option value={1800}>30 分钟</option>
                    <option value={3600}>1 小时</option>
                    <option value={7200}>2 小时</option>
                  </select>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>AI 自动命名</div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>为无标题的闪念/复盘生成标题</div>
                  </div>
                  <div onClick={() => setAutoTitle(v => !v)} style={{ width: 36, height: 20, borderRadius: 10, background: autoTitle ? "var(--sb-primary)" : "var(--sb-border)", position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: autoTitle ? 18 : 2, transition: "left 0.2s, right 0.2s" }} />
                  </div>
                </div>
              </div>
            </div>

            {/* System Info */}
            <div className="card">
              <div className="card-header"><span className="card-title">ℹ️ 系统信息</span></div>
              <div className="card-body">
                {[
                  { label: "API 地址", val: lmUrl },
                  { label: "向量数据库", val: "/data/vector-db" },
                  { label: "配置文件", val: "config/notion.yaml" },
                  { label: "日志目录", val: "logs/" },
                  { label: "同步间隔", val: intervalLabel(syncingInterval) },
                  { label: "后端服务", val: settings ? "运行中 (localhost:5100)" : "加载中..." },
                ].map(row => (
                  <div key={row.label} className="status-row">
                    <span className="status-label">{row.label}</span>
                    <span className="status-val" style={{ fontSize: 11, color: "var(--sb-text-secondary)" }}>{row.val}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
