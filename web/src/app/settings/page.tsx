"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save, RefreshCw, Plus, Trash2, Edit3, Check, Info,
  Plug, Cloud, Database, FolderOpen, FolderPlus, Server, Cpu, Bot, RotateCcw
} from "lucide-react";
import { apiClient, type AppSettings } from "@/lib/api";
import { useDataSources } from "@/lib/hooks";
import Sidebar from "@/components/Sidebar";

function mask(s: string, show = 4) {
  if (!s || s.length < 8) return "****";
  return s.slice(0, show) + "****" + s.slice(-show);
}

// 保留前缀和末尾，中间打码（用于 Notion 密钥默认展示）
function maskMiddle(s: string) {
  if (!s) return "";
  if (s.includes("****")) return s; // 后端已脱敏
  if (s.length <= 10) return "••••••";
  return s.slice(0, 4) + "••••••••••" + s.slice(-4);
}

function intervalLabel(s: number) {
  if (s <= 0) return "禁用";
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  return `${Math.floor(s / 3600)} 小时`;
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: value ? "var(--sb-primary)" : "var(--sb-border)",
        position: "relative", cursor: "pointer", transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: "50%", background: "white",
        position: "absolute", top: 2,
        left: value ? 18 : 2, transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
      {children}
    </div>
  );
}

function FieldInput({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)",
        borderRadius: 8, padding: "8px 10px", fontSize: 12,
        color: "var(--sb-text)", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
      }}
      onFocus={e => (e.target.style.borderColor = "var(--sb-primary)")}
      onBlur={e => (e.target.style.borderColor = "var(--sb-border)")}
    />
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [lmUrl, setLmUrl] = useState("http://localhost:1234/v1");
  const [onlineUrl, setOnlineUrl] = useState("");
  const [onlineApiKey, setOnlineApiKey] = useState("");
  const [onlineDefaultModel, setOnlineDefaultModel] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [dbEntries, setDbEntries] = useState<Array<{ name: string; id: string; editing?: boolean }>>([]);
  const [newDbName, setNewDbName] = useState("");
  const [newDbId, setNewDbId] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncingInterval, setSyncingInterval] = useState(21600);
  const [autoSync, setAutoSync] = useState(false);
  const [autoTitle, setAutoTitle] = useState(true);
  const [maintRunning, setMaintRunning] = useState<"" | "rename" | "reindex">("");
  const [maintMsg, setMaintMsg] = useState("");
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [onlineModels, setOnlineModels] = useState<string[]>([]);
  const [fetchingLocal, setFetchingLocal] = useState(false);
  const [fetchingOnline, setFetchingOnline] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourcePath, setNewSourcePath] = useState("");
  const [reviewSummaryPrompt, setReviewSummaryPrompt] = useState("帮我总结今日复盘，并且给我下一步的建议。");
  const [autoShowSummary, setAutoShowSummary] = useState(true);
  const [notionTokenFull, setNotionTokenFull] = useState("");
  const [tokenEditing, setTokenEditing] = useState(false);
  const [localNotesPath, setLocalNotesPath] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<string | null>(null);
  const [regenDropOpen, setRegenDropOpen] = useState(false);
  const { sources, addSource, removeSource } = useDataSources();
  const [mounted, setMounted] = useState(false);
  const [modelToast, setModelToast] = useState("");
  const customSources = mounted ? sources.filter(s => s.id !== "notion" && s.id !== "local") : [];

  useEffect(() => {
    setMounted(true);
  }, []);

  // 仅保存模型「配置」（默认模型 + API），不切换正在使用的模型——切换统一在左下角下拉菜单
  async function saveModelConfig(next: { localDefault?: string; onlineDefault?: string }) {
    try {
      await apiClient.saveSettings({
        lm_studio: { url: lmUrl, default_model: next.localDefault ?? defaultModel },
        online: { url: onlineUrl, api_key: onlineApiKey, default_model: next.onlineDefault ?? onlineDefaultModel },
      });
      setModelToast("已保存配置 ✓");
      setTimeout(() => setModelToast(""), 2000);
    } catch {
      setModelToast("保存失败，请重试");
      setTimeout(() => setModelToast(""), 2000);
    }
  }

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([apiClient.getSettings(), apiClient.getModels()]);
      setSettings(s);
      setLmUrl(s.lm_studio?.url || "http://localhost:1234/v1");
      setOnlineUrl(s.online?.url || "");
      setOnlineApiKey(s.online?.api_key || "");
      setOnlineDefaultModel(s.online?.default_model || "");
      setDefaultModel(s.lm_studio?.default_model || "");
      setSyncingInterval(s.sync?.interval || 21600);
      setAutoSync(s.sync?.auto || false);
      setAutoTitle(s.sync?.auto_title ?? true);
      setReviewSummaryPrompt(s.review?.summary_prompt || "帮我总结今日复盘，并且给我下一步的建议。");
      setAutoShowSummary(s.review?.auto_show_summary !== false);
      setLocalNotesPath(s.local_notes?.path || "");
      // 取明文用于编辑回显（本地单机应用）— 包含 online_api_key
      try {
        const sec = await apiClient.getSettingsSecret();
        setNotionTokenFull(sec.notion_token || "");
        if (sec.local_notes_path) setLocalNotesPath(sec.local_notes_path);
        if (sec.online_api_key) setOnlineApiKey(sec.online_api_key);
      } catch {}
      const raw = s.notion?.databases || {};
      const entries: Array<{ name: string; id: string; editing?: boolean }> = [];
      for (const [name, val] of Object.entries(raw)) {
        const v = val as { id?: string } | string;
        entries.push({ name, id: typeof v === "string" ? v : (v.id || "") });
      }
      setDbEntries(entries);
      setLocalModels(m.models || []);
      // load cached online models
      try {
        const cached = localStorage.getItem("aimira-online-models");
        if (cached) setOnlineModels(JSON.parse(cached));
      } catch {}
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { loadSettings(); }, []);

  // 经 Flask 代理拉 LM Studio 模型，避免浏览器直连 CORS 失败
  async function fetchLocalModels() {
    setFetchingLocal(true);
    try {
      // 写入 URL（带上当前 default_model 满足类型/后端合并）
      await apiClient.saveSettings({
        lm_studio: { url: lmUrl, default_model: defaultModel },
      });
      const m = await apiClient.getModels();
      setLocalModels(m.models || []);
    } catch {
      setLocalModels([]);
    } finally {
      setFetchingLocal(false);
    }
  }

  // 经 Flask /api/online_models 代理，避免 CORS
  async function fetchOnlineModels() {
    setFetchingOnline(true);
    try {
      await apiClient.saveSettings({
        online: { url: onlineUrl, api_key: onlineApiKey, default_model: onlineDefaultModel },
      });
      const r = await apiClient.getOnlineModels();
      const list = r.models || [];
      setOnlineModels(list);
      localStorage.setItem("aimira-online-models", JSON.stringify(list));
    } catch {
      setOnlineModels([]);
    } finally {
      setFetchingOnline(false);
    }
  }

  /** 调用后端原生目录选择器，填入对应输入框 */
  async function pickDirectory(target: "notes" | "source") {
    try {
      const r = await apiClient.pickDirectory();
      if (r.cancelled || !r.path) return;
      if (target === "notes") setLocalNotesPath(r.path);
      else setNewSourcePath(r.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(`选择目录失败: ${msg}（也可手动粘贴路径）`);
      setTimeout(() => setSaveError(""), 4000);
    }
  }

  async function runRename() {
    setMaintRunning("rename"); setMaintMsg("");
    try {
      const r = await apiClient.sync();
      if (r.error) throw new Error(r.error);
      setMaintMsg(`已执行同步，未命名的闪念/复盘已尝试用 AI 生成标题（处理 ${r.synced ?? 0} 条）`);
    } catch (e) { setMaintMsg(`操作失败：${e instanceof Error ? e.message : String(e)}`); }
    finally { setMaintRunning(""); }
  }
  async function runReindex() {
    setMaintRunning("reindex"); setMaintMsg("");
    try {
      const r = await apiClient.reindex();
      if (r.error) throw new Error(r.error);
      setMaintMsg(`向量索引已重建，共重新嵌入 ${r.reindexed ?? 0} 条笔记`);
    } catch (e) { setMaintMsg(`重建失败：${e instanceof Error ? e.message : String(e)}`); }
    finally { setMaintRunning(""); }
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
        notion_token: notionTokenFull && !notionTokenFull.includes("****") ? notionTokenFull : undefined,
        local_notes: { path: localNotesPath.trim() },
        lm_studio: { url: lmUrl, default_model: defaultModel },
        online: { url: onlineUrl, api_key: onlineApiKey, default_model: onlineDefaultModel },
        sync: { interval: syncingInterval, auto: autoSync, auto_title: autoTitle },
        review: { summary_prompt: reviewSummaryPrompt, auto_show_summary: autoShowSummary },
      });
      setTokenEditing(false);
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

  const card: React.CSSProperties = {
    background: "var(--sb-surface)", border: "1px solid var(--sb-border)",
    borderRadius: 14, overflow: "hidden",
  };
  const cardHeader: React.CSSProperties = {
    padding: "12px 16px", borderBottom: "1px solid var(--sb-border)",
    display: "flex", alignItems: "center", justifyContent: "space-between",
  };
  const cardBody: React.CSSProperties = { padding: "16px" };

  return (
    <div className="app-layout">
      <Sidebar activePage="settings" />

      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <h1>设置</h1>
            <div className="subtitle">修改配置后保存将自动更新</div>
          </div>
          <div className="topbar-right">
            <button className="btn-primary" onClick={handleSave} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Save size={13} />
              {saved ? "已保存" : "保存设置"}
            </button>
          </div>
        </div>

        <div className="content" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, alignItems: "start", minHeight: "calc(100vh - 70px)", overflowY: "auto" }}>

          {/* LEFT */}
          <div style={{ padding: "20px 20px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

            {saveError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#b91c1c" }}>
                保存失败: {saveError}
              </div>
            )}

            {/* ── 本地模型配置 ── */}
            <div style={card}>
              <div style={cardHeader}>
                <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Cpu size={14} /> 本地模型 · LM Studio
                </span>
                {modelToast && <span style={{ fontSize: 11, color: modelToast.includes("✓") ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{modelToast}</span>}
              </div>
              <div style={cardBody}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <SectionTitle><Plug size={12} /> API 地址</SectionTitle>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <FieldInput value={lmUrl} onChange={setLmUrl} placeholder="http://localhost:1234/v1" />
                    </div>
                    <button className="btn-ghost" onClick={fetchLocalModels} disabled={fetchingLocal} style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", fontSize: 12 }}>
                      <RefreshCw size={12} style={{ animation: fetchingLocal ? "spin 1s linear infinite" : "none" }} />
                      {fetchingLocal ? "获取中..." : "获取模型"}
                    </button>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)", marginBottom: 6 }}>默认模型</div>
                    <select
                      value={defaultModel}
                      onChange={e => { setDefaultModel(e.target.value); saveModelConfig({ localDefault: e.target.value }); }}
                      style={{ width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "var(--sb-text)", fontFamily: "inherit", outline: "none" }}
                    >
                      <option value="">选择模型...</option>
                      {localModels.map(m => <option key={m} value={m}>{m}</option>)}
                      {!localModels.length && <option value="" disabled>点击&quot;获取模型&quot;从 LM Studio 加载</option>}
                    </select>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--sb-text-muted)", lineHeight: 1.5 }}>
                    已检测到 {localModels.length} 个本地模型 · 这里只配置 API 与默认模型，实际使用哪个模型请在左下角下拉菜单切换。
                  </div>
                </div>
              </div>
            </div>

            {/* ── 线上模型配置 ── */}
            <div style={card}>
              <div style={cardHeader}>
                <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Cloud size={14} /> 线上模型 · OpenAI 兼容
                </span>
              </div>
              <div style={cardBody}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)", marginBottom: 4 }}>API 地址</div>
                    <FieldInput value={onlineUrl} onChange={setOnlineUrl} placeholder="https://api.openai.com/v1" />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)", marginBottom: 4 }}>API Key</div>
                    <FieldInput value={onlineApiKey} onChange={setOnlineApiKey} type="password" placeholder="sk-..." />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>默认模型</div>
                      <button className="btn-ghost" onClick={fetchOnlineModels} disabled={fetchingOnline || !onlineUrl} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "4px 10px" }}>
                        <RefreshCw size={11} style={{ animation: fetchingOnline ? "spin 1s linear infinite" : "none" }} />
                        {fetchingOnline ? "获取中..." : "获取模型"}
                      </button>
                    </div>
                    <select
                      value={onlineDefaultModel}
                      onChange={e => { setOnlineDefaultModel(e.target.value); saveModelConfig({ onlineDefault: e.target.value }); }}
                      style={{ width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "var(--sb-text)", fontFamily: "inherit", outline: "none" }}
                    >
                      <option value="">选择模型...</option>
                      {onlineModels.map(m => <option key={m} value={m}>{m}</option>)}
                      {!onlineModels.length && <option value="" disabled>输入地址和 Key 后点击&quot;获取模型&quot;</option>}
                    </select>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--sb-text-muted)", lineHeight: 1.5 }}>
                    支持 OpenAI、MiniMax、DeepSeek 等兼容接口 · 实际使用哪个模型请在左下角下拉菜单切换。
                  </div>
                </div>
              </div>
            </div>

            {/* ── Notion Databases ── */}
            <div style={card}>
              <div style={cardHeader}>
                <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Database size={14} /> Notion 数据库配置
                </span>
                <span className="badge green" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Check size={10} /> 已连接
                </span>
              </div>
              <div style={cardBody}>
                {/* Notion 集成密钥（NTN Token）：默认打码，编辑时显示完整 */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-text-secondary)", marginBottom: 6 }}>Notion 集成密钥（Integration Token）</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      value={tokenEditing ? notionTokenFull : maskMiddle(notionTokenFull || settings?.notion?.token || "")}
                      readOnly={!tokenEditing}
                      onChange={e => setNotionTokenFull(e.target.value)}
                      placeholder="ntn_xxxxxxxx..."
                      style={{ flex: 1, background: tokenEditing ? "white" : "var(--sb-muted)", border: `1px solid ${tokenEditing ? "var(--sb-primary)" : "var(--sb-border)"}`, borderRadius: 8, padding: "8px 11px", fontSize: 12, fontFamily: "ui-monospace, monospace", outline: "none", color: "var(--sb-text)" }} />
                    <button onClick={() => setTokenEditing(v => !v)} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "8px 13px", whiteSpace: "nowrap" }}>
                      {tokenEditing ? <><Check size={12} /> 完成</> : <><Edit3 size={12} /> 编辑</>}
                    </button>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--sb-text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                    连接私有库需要的集成密钥（形如 <code style={{ background: "var(--sb-muted)", padding: "1px 4px", borderRadius: 3 }}>ntn_…</code>）。在 Notion 集成里创建后，需把对应数据库「连接」到该集成才能访问。默认打码，点击「编辑」查看/修改完整密钥，改完记得点右上角保存。
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {dbEntries.map((db, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--sb-muted)", borderRadius: 8, padding: "7px 10px" }}>
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
                      <button onClick={() => setDbEntries(prev => prev.map((d, i) => i === idx ? { ...d, editing: !d.editing } : d))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--brand-500)", padding: 3, display: "flex", alignItems: "center" }}>
                        {db.editing ? <Check size={13} /> : <Edit3 size={13} />}
                      </button>
                      <button onClick={() => setDbEntries(prev => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 3, display: "flex", alignItems: "center" }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" value={newDbName} onChange={e => setNewDbName(e.target.value)} placeholder="数据库名称"
                    style={{ flex: 1, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                  <input type="text" value={newDbId} onChange={e => setNewDbId(e.target.value)} placeholder="Database ID（32位）"
                    style={{ flex: 2, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                  <button onClick={addDb} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "7px 12px", whiteSpace: "nowrap" }}>
                    <Plus size={12} /> 添加
                  </button>
                </div>

                <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--sb-muted)", borderRadius: 8, fontSize: 11, color: "var(--sb-text-muted)" }}>
                  <Info size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                  Database ID 在 Notion URL 中：<code style={{ background: "var(--sb-border)", padding: "1px 4px", borderRadius: 3 }}>notion.so/[用户名]/[名称]-[32位ID]</code>
                </div>
              </div>
            </div>

            {/* ── 知识库配置 ── */}
            <div id="sources" style={card}>
              <div style={cardHeader}>
                <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FolderOpen size={14} /> 知识库配置
                </span>
              </div>
              <div style={cardBody}>
                {/* 本地笔记路径 */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-text-secondary)", marginBottom: 6 }}>本地笔记路径</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      data-testid="local-notes-path"
                      value={localNotesPath}
                      onChange={e => setLocalNotesPath(e.target.value)}
                      placeholder="例如：/Users/viceroy/notes"
                      style={{ flex: 1, minWidth: 0, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "8px 11px", fontSize: 12, fontFamily: "inherit", outline: "none", color: "var(--sb-text)", boxSizing: "border-box" }} />
                    <button
                      type="button"
                      data-testid="pick-local-notes-path"
                      className="btn-ghost"
                      onClick={() => pickDirectory("notes")}
                      style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", fontSize: 12, flexShrink: 0 }}
                    >
                      <FolderOpen size={12} /> 选择
                    </button>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--sb-text-muted)", marginTop: 6 }}>
                    <FolderOpen size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                    本地 Markdown 笔记所在目录，保存后用于「本地笔记」数据源。连接 / 断开请在左侧边栏对应数据源的指示灯上点击。
                  </div>
                </div>

                {/* 仅展示自定义知识库（Notion / 本地笔记的接入状态在侧栏控制，此处不重复） */}
                {customSources.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                    {customSources.map(src => (
                      <div key={src.id} style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--sb-muted)", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: src.active ? "var(--sb-success)" : "var(--sb-border)", flexShrink: 0 }} />
                        <FolderOpen size={13} style={{ color: "var(--sb-text-secondary)", flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--sb-text)" }}>{src.name}</span>
                        {src.path && <code style={{ fontSize: 10, color: "var(--sb-text-muted)", background: "white", padding: "2px 6px", borderRadius: 4 }}>{src.path}</code>}
                        <button onClick={() => removeSource(src.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 3, display: "flex", alignItems: "center" }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ background: "var(--sb-muted)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb-text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <FolderPlus size={13} /> 添加本地知识库
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input type="text" value={newSourceName} onChange={e => setNewSourceName(e.target.value)} placeholder="名称（如：技术电子书）"
                      style={{ flex: 1, background: "white", border: "1px solid var(--sb-border)", borderRadius: 7, padding: "6px 10px", fontSize: 11, fontFamily: "inherit", outline: "none" }} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      data-testid="new-source-path"
                      value={newSourcePath}
                      onChange={e => setNewSourcePath(e.target.value)}
                      placeholder="/Users/你/电子书目录"
                      style={{ flex: 1, minWidth: 0, background: "white", border: "1px solid var(--sb-border)", borderRadius: 7, padding: "6px 10px", fontSize: 11, fontFamily: "inherit", outline: "none" }}
                    />
                    <button
                      type="button"
                      data-testid="pick-new-source-path"
                      className="btn-ghost"
                      onClick={() => pickDirectory("source")}
                      style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "6px 10px", whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                      <FolderOpen size={12} /> 选择
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (newSourceName.trim() && newSourcePath.trim()) {
                          addSource({ id: `custom-${Date.now()}`, name: newSourceName.trim(), type: "custom", path: newSourcePath.trim() });
                          setNewSourceName(""); setNewSourcePath("");
                        }
                      }}
                      className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "6px 12px", whiteSpace: "nowrap" }}>
                      <Plus size={12} /> 添加
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sb-text-muted)", marginTop: 8 }}>
                    添加后系统将索引该目录下的 PDF、TXT、MD 文件
                  </div>
                </div>
              </div>
            </div>

            {/* ── Review Settings ── */}
            <div style={{ ...card, overflow: "visible" }}>
              <div style={cardHeader}>
                <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Bot size={14} /> 复盘设置
                </span>
              </div>
              <div style={cardBody}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>保存后自动弹出 AI 总结</div>
                      <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>复盘保存完成后，自动弹窗展示 AI 总结</div>
                    </div>
                    <Toggle value={autoShowSummary} onChange={setAutoShowSummary} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)", marginBottom: 4 }}>AI 总结提示词</div>
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)", marginBottom: 8 }}>
                      每次保存复盘后，AI 会用此提示词生成总结。可自由修改。
                    </div>
                    <textarea
                      value={reviewSummaryPrompt}
                      onChange={e => setReviewSummaryPrompt(e.target.value)}
                      rows={4}
                      placeholder="帮我总结今日复盘，并且给我下一步的建议。"
                      style={{
                        width: "100%", background: "var(--sb-muted)", border: "1px solid var(--sb-border)",
                        borderRadius: 8, padding: "9px 11px", fontSize: 12,
                        color: "var(--sb-text)", fontFamily: "inherit", outline: "none",
                        resize: "vertical", boxSizing: "border-box", lineHeight: 1.6,
                      }}
                      onFocus={e => (e.target.style.borderColor = "var(--sb-primary)")}
                      onBlur={e => (e.target.style.borderColor = "var(--sb-border)")}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <button
                        onClick={() => setReviewSummaryPrompt("帮我总结今日复盘，并且给我下一步的建议。")}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--sb-text-muted)", display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
                        <RotateCcw size={11} /> 恢复默认
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {regenResult && (
                          <span style={{ fontSize: 11, color: "#16a34a" }}>{regenResult}</span>
                        )}
                        {/* Split dropdown button */}
                        <div style={{ position: "relative" }}>
                          <div style={{ display: "flex", borderRadius: 7, overflow: "hidden", border: "1px solid var(--sb-primary)" }}>
                            <button
                              disabled={regenerating}
                              onClick={async () => {
                                setRegenDropOpen(false);
                                setRegenerating(true);
                                setRegenResult(null);
                                try {
                                  const r = await fetch("http://localhost:5100/api/regenerate_summaries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "year" }) });
                                  const d = await r.json();
                                  setRegenResult(`已重新生成 ${(d.notion || 0) + (d.local || 0)} 条`);
                                  setTimeout(() => setRegenResult(null), 4000);
                                } catch { setRegenResult("生成失败"); }
                                finally { setRegenerating(false); }
                              }}
                              style={{
                                display: "flex", alignItems: "center", gap: 5,
                                background: regenerating ? "var(--sb-muted)" : "var(--sb-primary)",
                                color: regenerating ? "var(--sb-text-muted)" : "white",
                                border: "none", padding: "6px 11px",
                                fontSize: 11, fontWeight: 600, cursor: regenerating ? "not-allowed" : "pointer",
                              }}>
                              <RefreshCw size={11} style={{ animation: regenerating ? "spin 1s linear infinite" : "none" }} />
                              {regenerating ? "生成中..." : "重新生成总结"}
                            </button>
                            <button
                              disabled={regenerating}
                              onClick={() => setRegenDropOpen(v => !v)}
                              style={{
                                background: regenerating ? "var(--sb-muted)" : "var(--sb-primary)",
                                color: regenerating ? "var(--sb-text-muted)" : "white",
                                border: "none", borderLeft: "1px solid rgba(255,255,255,0.25)",
                                padding: "6px 7px", cursor: regenerating ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center",
                              }}>
                              <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor"><path d="M1 1l4 4 4-4"/></svg>
                            </button>
                          </div>
                          {regenDropOpen && !regenerating && (
                            <div style={{
                              position: "absolute", right: 0, top: "calc(100% + 4px)",
                              background: "white", border: "1px solid var(--sb-border)",
                              borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                              zIndex: 50, minWidth: 180, overflow: "hidden",
                            }}>
                              {[
                                { label: "近 1 年内的复盘", scope: "year" },
                                { label: "全部复盘", scope: "all" },
                              ].map(opt => (
                                <button key={opt.scope}
                                  onClick={async () => {
                                    setRegenDropOpen(false);
                                    setRegenerating(true);
                                    setRegenResult(null);
                                    try {
                                      const r = await fetch("http://localhost:5100/api/regenerate_summaries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: opt.scope }) });
                                      const d = await r.json();
                                      setRegenResult(`已重新生成 ${(d.notion || 0) + (d.local || 0)} 条`);
                                      setTimeout(() => setRegenResult(null), 4000);
                                    } catch { setRegenResult("生成失败"); }
                                    finally { setRegenerating(false); }
                                  }}
                                  style={{
                                    width: "100%", display: "flex", alignItems: "center", gap: 7,
                                    padding: "9px 14px", border: "none", background: "none",
                                    cursor: "pointer", fontSize: 12, color: "var(--sb-text-secondary)",
                                    textAlign: "left", fontFamily: "inherit",
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.background = "var(--sb-muted)")}
                                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                                >
                                  <RefreshCw size={11} /> {opt.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Sync Settings ── */}
            <div style={card}>
              <div style={cardHeader}>
                <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <RefreshCw size={14} /> 同步设置
                </span>
              </div>
              <div style={cardBody}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {[
                    { label: "自动同步", sub: "本地更改后自动同步 + 每 6 小时全面检查", val: autoSync, set: setAutoSync },
                    { label: "AI 自动命名", sub: "为无标题的闪念/复盘生成标题", val: autoTitle, set: setAutoTitle },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>{row.label}</div>
                        <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>{row.sub}</div>
                      </div>
                      <Toggle value={row.val} onChange={row.set} />
                    </div>
                  ))}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>全面同步间隔</div>
                      <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>当前: {intervalLabel(syncingInterval)}</div>
                    </div>
                    <select value={syncingInterval} onChange={e => setSyncingInterval(Number(e.target.value))}
                      style={{ background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                      <option value={3600}>1 小时</option>
                      <option value={7200}>2 小时</option>
                      <option value={21600}>6 小时</option>
                      <option value={43200}>12 小时</option>
                      <option value={86400}>24 小时</option>
                      <option value={0}>禁用</option>
                    </select>
                  </div>

                  {/* 维护操作 */}
                  <div style={{ borderTop: "1px solid var(--sb-border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>维护操作</div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>AI 重命名笔记</div>
                        <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>对未命名的闪念/复盘用 AI 批量生成标题（随同步执行，需开启上面的「AI 自动命名」）</div>
                      </div>
                      <button onClick={runRename} disabled={maintRunning !== ""}
                        title="执行一次同步：会为没有标题的闪念/复盘笔记用 AI 自动生成标题"
                        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", color: "var(--sb-text)", cursor: maintRunning ? "default" : "pointer", opacity: maintRunning ? 0.6 : 1 }}>
                        {maintRunning === "rename" ? <RefreshCw size={13} className="spin" /> : <Bot size={13} />} {maintRunning === "rename" ? "处理中…" : "立即重命名"}
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>重建向量索引</div>
                        <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>清空增量状态后全量重新读取并嵌入所有笔记，用于修复 AI 检索结果异常 / 向量库与笔记不一致（耗时较长，不会删除原始数据）</div>
                      </div>
                      <button onClick={runReindex} disabled={maintRunning !== ""}
                        title="重新读取全部笔记并重建向量数据库索引；当 AI 引用/检索结果异常时使用"
                        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, background: "var(--sb-muted)", border: "1px solid var(--sb-border)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", color: "var(--sb-text)", cursor: maintRunning ? "default" : "pointer", opacity: maintRunning ? 0.6 : 1 }}>
                        {maintRunning === "reindex" ? <RefreshCw size={13} className="spin" /> : <Database size={13} />} {maintRunning === "reindex" ? "重建中…" : "重建索引"}
                      </button>
                    </div>

                    {maintMsg && <div style={{ fontSize: 11, color: "var(--sb-text-secondary)", background: "var(--sb-muted)", borderRadius: 8, padding: "8px 10px" }}>{maintMsg}</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: System Info */}
          <div style={{ padding: "20px 20px 20px 0" }}>
            <div style={card}>
              <div style={cardHeader}>
                <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Info size={14} /> 系统信息
                </span>
              </div>
              <div style={cardBody}>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {[
                    { label: "本地 API", val: lmUrl },
                    { label: "线上 API", val: onlineUrl || "未配置" },
                    { label: "向量数据库", val: "data/vector-db" },
                    { label: "配置文件", val: "config/notion.yaml" },
                    { label: "日志目录", val: "logs/" },
                    { label: "同步间隔", val: intervalLabel(syncingInterval) },
                    { label: "自动同步", val: autoSync ? "开启" : "关闭" },
                    { label: "后端服务", val: settings ? "运行中 :5100" : "加载中..." },
                    { label: "Web 服务", val: "运行中 :3000" },
                    { label: "数据源", val: `${sources.filter(s => s.active).length}/${sources.length} 已接入` },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid #f8fafc", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--sb-text-secondary)", flexShrink: 0 }}>{row.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--sb-text-secondary)", wordBreak: "break-all", textAlign: "right" }}>{row.val}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 14, padding: "10px", background: "var(--sb-muted)", borderRadius: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--sb-text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    本地模型 ({localModels.length})
                  </div>
                  {localModels.length > 0 ? localModels.map(m => (
                    <div key={m} style={{ fontSize: 11, color: "var(--sb-text-secondary)", padding: "3px 0", display: "flex", alignItems: "center", gap: 5 }}>
                      <Server size={10} style={{ flexShrink: 0, color: "var(--sb-success)" }} /> {m}
                    </div>
                  )) : (
                    <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>点击&quot;获取模型&quot;加载</div>
                  )}
                </div>

                {onlineModels.length > 0 && (
                  <div style={{ marginTop: 10, padding: "10px", background: "var(--sb-muted)", borderRadius: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--sb-text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      线上模型 ({onlineModels.length})
                    </div>
                    {onlineModels.map(m => (
                      <div key={m} style={{ fontSize: 11, color: "var(--sb-text-secondary)", padding: "3px 0", display: "flex", alignItems: "center", gap: 5 }}>
                        <Cloud size={10} style={{ flexShrink: 0, color: "var(--brand-500)" }} /> {m}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
