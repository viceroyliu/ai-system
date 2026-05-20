"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type AppSettings } from "@/lib/api";

function mask(s: string, show = 4) {
  if (!s || s.length < 8) return "****";
  return s.slice(0, show) + "****" + s.slice(-show);
}

function intervalLabel(s: number) {
  if (s <= 0) return "禁用";
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  return `${Math.floor(s / 3600)} 小时`;
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [lmUrl, setLmUrl] = useState("http://localhost:1234/v1");
  const [onlineUrl, setOnlineUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [dbEntries, setDbEntries] = useState<Array<{ name: string; id: string; editing?: boolean }>>([]);
  const [newDbName, setNewDbName] = useState("");
  const [newDbId, setNewDbId] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncingInterval, setSyncingInterval] = useState(21600); // 6h default
  const [autoSync, setAutoSync] = useState(false);
  const [autoTitle, setAutoTitle] = useState(true);
  const [currentModel, setCurrentModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiClient.getSettings();
      setSettings(s);
      setLmUrl(s.lm_studio?.url || "http://localhost:1234/v1");
      setOnlineUrl(s.online?.url || "");
      setDefaultModel(s.lm_studio?.default_model || "");
      setCurrentModel(s.lm_studio?.default_model || "");
      setSyncingInterval(s.sync?.interval || 21600);
      setAutoSync(s.sync?.auto || false);
      setAutoTitle(s.sync?.auto_title ?? true);
      const raw = s.notion?.databases || {};
      const entries: Array<{ name: string; id: string; editing?: boolean }> = [];
      for (const [name, val] of Object.entries(raw)) {
        const v = val as { id?: string } | string;
        entries.push({ name, id: typeof v === "string" ? v : (v.id || "") });
      }
      setDbEntries(entries);
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  async function fetchModelsFromUrl(url: string) {
    setFetchingModels(true);
    try {
      const base = url.replace(/\/$/, "");
      const resp = await fetch(`${base}/models`);
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      const list: string[] = Array.isArray(data.data)
        ? data.data.map((m: { id?: string; object?: string }) => m.id || "").filter(Boolean)
        : [];
      setAvailableModels(list);
    } catch {
      setAvailableModels([]);
    } finally {
      setFetchingModels(false);
    }
  }

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
        online: { url: onlineUrl },
        sync: { interval: syncingInterval, auto: autoSync, auto_title: autoTitle },
      } as Partial<AppSettings> & {
        notion_databases?: Record<string, { id: string; name: string }>;
        lm_studio?: { url: string; default_model: string };
        online?: { url: string };
        sync?: { interval: number; auto: boolean; auto_title: boolean };
      });
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

  function editDb(idx: number) {
    setDbEntries(prev => prev.map((d, i) => i === idx ? { ...d, editing: !d.editing } : d));
  }

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark"><span>AI</span></div>
          <div><div className="logo-text">人生导师</div><div className="logo-sub">v3.1</div></div>
        </div>
        <div className="search-box" onClick={() => router.push("/search")}><span>🔍 搜索知识库...</span><span className="key">⌘K</span></div>
        <div className="nav-section">
          <div className="nav-label">Main</div>
          <div className="nav-item" onClick={() => router.push("/")}><span>🏠</span> 概览</div>
          <div className="nav-item" onClick={() => router.push("/chat")}><span>💬</span> AI 对话</div>
          <div className="nav-item" onClick={() => router.push("/calendar")}><span>📅</span> 日历 &amp; 复盘</div>
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
          <select className="model-select" value={currentModel}
            onChange={async e => { try { await apiClient.setModel(e.target.value); setCurrentModel(e.target.value); } catch {} }}>
            <option value="">选择模型...</option>
            {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <h1>⚙️ 设置</h1>
            <div className="subtitle">修改配置后保存将自动更新配置并重启相关服务</div>
          </div>
          <div className="topbar-right">
            <button className="btn-primary" onClick={handleSave} disabled={loading}>
              {saved ? "✓ 已保存" : "💾 保存设置"}
            </button>
          </div>
        </div>

        <div className="content" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 0, alignItems: "start" }}>

          {/* LEFT: settings panels */}
          <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 680, overflow: "auto" }}>

            {saveError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#b91c1c" }}>
                保存失败: {saveError}
              </div>
            )}

            {/* Model Config */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🤖 模型配置</span>
              </div>
              <div className="card-body">
                {/* Local LM Studio */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    🔌 本地 API（LM Studio）
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <input type="text" value={lmUrl} onChange={e => setLmUrl(e.target.value)}
                      style={{ flex: 1, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "var(--sb-text)", fontFamily: "inherit", outline: "none" }}
                      placeholder="http://localhost:1234/v1" />
                    <button className="btn-ghost btn-sm" onClick={() => fetchModelsFromUrl(lmUrl)} disabled={fetchingModels}>
                      {fetchingModels ? "刷新中..." : "🔄 刷新模型"}
                    </button>
                  </div>
                  <select className="model-select" value={defaultModel}
                    onChange={e => setDefaultModel(e.target.value)}
                    style={{ width: "100%", marginBottom: 4 }}>
                    <option value="">选择模型...</option>
                    {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                    {!availableModels.length && <option value="" disabled>在 LM Studio 加载模型后点击刷新</option>}
                  </select>
                  <div style={{ fontSize: 10, color: "var(--sb-text-muted)" }}>
                    当前: {currentModel || "未选择"} ·{" "}
                    {availableModels.length > 0
                      ? `检测到 ${availableModels.length} 个模型`
                      : "点击刷新从 LM Studio 获取可用模型"}
                  </div>
                </div>

                {/* Online API */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    ☁️ 线上 API（OpenAI-compatible）
                  </div>
                  <input type="text" value={onlineUrl} onChange={e => setOnlineUrl(e.target.value)}
                    style={{ width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "var(--sb-text)", fontFamily: "inherit", outline: "none", marginBottom: 4 }}
                    placeholder="https://api.minimax.chat/v1 或 https://api.openai.com/v1" />
                  <div style={{ fontSize: 10, color: "var(--sb-text-muted)" }}>
                    支持 OpenAI-compatible 接口，输入 URL 后按回车刷新模型列表
                  </div>
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
                  Token: <code style={{ background: "var(--sb-muted)", padding: "1px 4px", borderRadius: 3 }}>{mask(settings?.notion?.token || "secret_xxxx", 8)}</code>
                  &nbsp;· 点击数据库行可直接编辑
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {dbEntries.map((db, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--sb-muted)", borderRadius: 8, padding: "8px 10px" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sb-text)", flex: 1 }}>{db.name}</span>
                      {db.editing ? (
                        <input type="text" value={db.id}
                          onChange={e => setDbEntries(prev => prev.map((d, i) => i === idx ? { ...d, id: e.target.value } : d))}
                          style={{ flex: 2, background: "white", border: "1px solid var(--sb-primary)", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontFamily: "inherit", outline: "none" }}
                          placeholder="Notion Database ID" />
                      ) : (
                        <code style={{ flex: 2, fontSize: 11, color: "var(--sb-text-secondary)", background: "white", padding: "3px 8px", borderRadius: 4 }}>
                          {mask(db.id)}
                        </code>
                      )}
                      <button onClick={() => editDb(idx)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6366f1", padding: "2px 4px" }}>
                        {db.editing ? "✓" : "✏️"}
                      </button>
                      <button onClick={() => removeDb(idx)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#ef4444", padding: "2px 4px" }}>✕</button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <input type="text" value={newDbName} onChange={e => setNewDbName(e.target.value)} placeholder="数据库名称"
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
                {/* Auto sync toggle */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>自动同步（Auto）</div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>本地更改后自动同步 + 每 6 小时全面检查</div>
                  </div>
                  <div onClick={() => setAutoSync(v => !v)} style={{ width: 36, height: 20, borderRadius: 10, background: autoSync ? "var(--sb-primary)" : "var(--sb-border)", position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: autoSync ? 18 : 2, transition: "left 0.2s, right 0.2s" }} />
                  </div>
                </div>

                {/* Sync interval */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>全面同步间隔</div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>当前: {intervalLabel(syncingInterval)}</div>
                  </div>
                  <select value={syncingInterval} onChange={e => setSyncingInterval(Number(e.target.value))}
                    style={{ background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                    <option value={21600}>6 小时</option>
                    <option value={43200}>12 小时</option>
                    <option value={86400}>24 小时</option>
                    <option value={3600}>1 小时</option>
                    <option value={7200}>2 小时</option>
                    <option value={0}>禁用</option>
                  </select>
                </div>

                {/* Auto title */}
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
          </div>

          {/* RIGHT: System Info */}
          <div style={{ padding: "20px 24px 20px 0", borderLeft: "1px solid var(--sb-border)", height: "100%", overflow: "auto" }}>
            <div className="card" style={{ marginLeft: 0 }}>
              <div className="card-header"><span className="card-title">ℹ️ 系统信息</span></div>
              <div className="card-body">
                {[
                  { label: "本地 API", val: lmUrl },
                  { label: "线上 API", val: onlineUrl || "未配置" },
                  { label: "向量数据库", val: "/data/vector-db" },
                  { label: "配置文件", val: "config/notion.yaml" },
                  { label: "日志目录", val: "logs/" },
                  { label: "同步间隔", val: intervalLabel(syncingInterval) },
                  { label: "自动同步", val: autoSync ? "开启" : "关闭" },
                  { label: "后端服务", val: settings ? "运行中 :5100" : "加载中..." },
                  { label: "Web 服务", val: "运行中 :3000" },
                ].map(row => (
                  <div key={row.label} className="status-row">
                    <span className="status-label">{row.label}</span>
                    <span className="status-val" style={{ fontSize: 11, color: "var(--sb-text-secondary)", wordBreak: "break-all", textAlign: "right" }}>{row.val}</span>
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
