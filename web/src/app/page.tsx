"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api";
import type { ApiStatus, ApiModels, SearchResult } from "@/lib/types";

// ===== Module types =====
type ModuleId = 'hero' | 'stats' | 'sync' | 'vector' | 'logs' | 'quick' | 'notion' | 'sys';

interface Module {
  id: ModuleId;
  title: string;
  icon: string;
  col: 1 | 2 | 'full'; // grid column placement
}

// ===== Module registry =====
const ALL_MODULES: Module[] = [
  { id: 'hero', title: 'AI 搜索', icon: '🤖', col: 'full' },
  { id: 'stats', title: '统计卡片', icon: '📊', col: 1 },
  { id: 'sync', title: 'Notion 同步', icon: '🔄', col: 1 },
  { id: 'vector', title: '向量数据库', icon: '🗄️', col: 1 },
  { id: 'logs', title: '最近日志', icon: '📋', col: 1 },
  { id: 'quick', title: '快捷操作', icon: '⚡', col: 2 },
  { id: 'notion', title: 'Notion 数据库', icon: '🗂️', col: 2 },
  { id: 'sys', title: '系统状态', icon: '⚙️', col: 2 },
];

const STORAGE_KEY = 'nexus-dashboard-layout-v1';

function getLayout(): ModuleId[] {
  if (typeof window === 'undefined') return ALL_MODULES.map(m => m.id);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return ALL_MODULES.map(m => m.id);
}

function saveLayout(order: ModuleId[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

function getTimeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时`;
    return `${Math.floor(h / 24)} 天`;
  } catch { return ""; }
}

function parseLogLine(line: string) {
  const idx = line.indexOf("]");
  const time = idx > 0 ? line.slice(1, idx) : line.slice(0, 8);
  const msg = idx > 0 ? line.slice(idx + 1).trim() : line;
  let icon = "📄", badge = "info";
  if (msg.includes("✅") || msg.includes("完成")) { icon = "✓"; badge = "ok"; }
  else if (msg.includes("开始") || msg.includes("同步")) { icon = "🔄"; badge = "run"; }
  else if (msg.includes("❌") || msg.includes("错误")) { icon = "✗"; badge = "err"; }
  const title = msg.replace(/[✅❌🔄⚠️✗]/g, "").trim().slice(0, 60);
  const bgMap: Record<string, string> = { ok: "#f0fdf4", err: "#fef2f2", run: "#fef3c7", warn: "#fef3c7", info: "#f1f5f9" };
  return { time, title, badge, icon, bg: bgMap[badge] || "#f1f5f9" };
}

// ===== Draggable Module Wrapper =====
function DraggableModule({
  id, children, onDragStart, onDragOver, onDrop, isDragOver,
}: {
  id: ModuleId;
  children: React.ReactNode;
  onDragStart: (e: React.DragEvent, id: ModuleId) => void;
  onDragOver: (e: React.DragEvent, id: ModuleId) => void;
  onDrop: (e: React.DragEvent, id: ModuleId) => void;
  isDragOver: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e, id); }}
      onDrop={(e) => onDrop(e, id)}
      style={{
        opacity: 0.95,
        transition: 'outline 0.15s',
        outline: isDragOver ? '2px dashed #6366f1' : '2px solid transparent',
        outlineOffset: '4px',
        borderRadius: '14px',
        cursor: 'grab',
      }}
    >
      {children}
    </div>
  );
}

// ===== Main Page =====
export default function DashboardPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [models, setModels] = useState<ApiModels | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [moduleOrder, setModuleOrder] = useState<ModuleId[]>([]);
  const [dragOverId, setDragOverId] = useState<ModuleId | null>(null);
  const dragSrc = useRef<ModuleId | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [s, m, l] = await Promise.all([
        apiClient.getStatus(),
        apiClient.getModels(),
        apiClient.getLogs(),
      ]);
      setStatus(s);
      setModels(m);
      setLogs(l.lines || []);
    } catch (e) { console.error("Failed to load:", e); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setModuleOrder(getLayout()); }, []);

  async function doSync() { setSyncing(true); try { await apiClient.sync(); await loadAll(); } finally { setSyncing(false); } }

  async function handleSearch(q: string) {
    if (!q.trim()) { setShowResults(false); return; }
    setSearching(true);
    try {
      const r = await apiClient.search(q, 5);
      setSearchResults(r.results || []); setShowResults(true);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }

  // ---- Drag and Drop ----
  function handleDragStart(e: React.DragEvent, id: ModuleId) {
    dragSrc.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent, id: ModuleId) {
    e.preventDefault();
    setDragOverId(id);
  }
  function handleDrop(e: React.DragEvent, targetId: ModuleId) {
    e.preventDefault();
    setDragOverId(null);
    if (!dragSrc.current || dragSrc.current === targetId) return;
    const newOrder = [...moduleOrder];
    const srcIdx = newOrder.indexOf(dragSrc.current);
    const tgtIdx = newOrder.indexOf(targetId);
    newOrder.splice(srcIdx, 1);
    newOrder.splice(tgtIdx, 0, dragSrc.current);
    setModuleOrder(newOrder);
    saveLayout(newOrder);
    dragSrc.current = null;
  }

  const modules = moduleOrder.length ? moduleOrder.map(id => ALL_MODULES.find(m => m.id === id)!).filter(Boolean) : ALL_MODULES;

  const renderModule = (mod: Module) => {
    const currentModel = models?.current || "";

    if (mod.id === 'hero') return (
      <div className="ai-hero" key={mod.id} style={{ cursor: 'default' }}>
        <div className="ai-hero-badge">🤖 AI 助手 · <span>{currentModel ? `${currentModel} 已就绪` : "本地模型已就绪"}</span></div>
        <h2>今天想思考什么？</h2>
        <p>输入问题，基于你的 <span>{status?.documents ?? "—"}</span> 条笔记和向量数据库回答</p>
        <input id="search-input-hero" placeholder="💬 输入问题，按回车搜索知识库..."
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); if (searchTimeout.current) clearTimeout(searchTimeout.current); searchTimeout.current = setTimeout(() => handleSearch(e.target.value), 600); }}
          onKeyDown={e => { if (e.key === "Enter") handleSearch(searchQuery); }}
        />
        <div className="scenes-grid">
          {[{ icon: "🎯", title: "本周复盘", sub: "基于笔记生成洞察", q: "本周复盘" }, { icon: "🔍", title: "知识盲点扫描", sub: "找出你没意识到的缺口", q: "知识盲点扫描" }, { icon: "🧭", title: "学习路径推荐", sub: "下一步该学什么？", q: "学习路径推荐" }, { icon: "💡", title: "灵感关联", sub: "连接不同领域的想法", q: "灵感关联" }].map(s => (
            <button key={s.q} className="scene-btn" onClick={() => { setSearchQuery(s.q); handleSearch(s.q); }} style={{ textAlign: 'left' }}>
              <span className="scene-icon">{s.icon}</span><span className="scene-title">{s.title}</span><span className="scene-sub">{s.sub}</span><span className="scene-arrow">→ 立即开始</span>
            </button>
          ))}
        </div>
        <div className="model-chips">
          {(models?.models || []).map(model => (
            <span key={model} className={`model-chip ${model === currentModel ? "active" : ""}`}
              onClick={async () => { try { await apiClient.setModel(model); const m = await apiClient.getModels(); setModels(m); } catch {} }}>
              {model}
            </span>
          ))}
        </div>
      </div>
    );

    if (mod.id === 'stats') return (
      <div className="card" key={mod.id} style={{ cursor: 'default' }}>
        <div className="card-header"><span className="card-title">📊 统计概览</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[
              { label: '向量文档', val: status?.documents ?? "—", sub: `${(status?.collections || []).length || "?"} 个 Collection` },
              { label: '最后同步', val: status?.last_sync ? status.last_sync.slice(11, 16) : "—", sub: status?.last_sync ? `${getTimeAgo(status.last_sync)} 前` : "" },
              { label: '服务状态', val: status?.service_running ? '运行中' : '已停止', dot: status?.service_running ? 'green' : 'yellow' },
              { label: 'API 状态', val: status?.last_error ? '异常' : '正常', dot: status?.last_error ? 'red' : 'green' },
            ].map(item => (
              <div key={item.label} style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>{item.label}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  {item.dot ? <><span className={`dot ${item.dot}`} style={{ marginRight: '6px' }}></span>{item.val}</> : item.val}
                </div>
                {item.sub && <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{item.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (mod.id === 'sync') return (
      <div className="card" key={mod.id} style={{ cursor: 'default' }}>
        <div className="card-header"><span className="card-title">🔄 NOTION 同步</span><span className="badge green">✓</span></div>
        <div className="card-body">
          <div className="sync-status-row"><span className="dot green"></span><span className="sync-title">{status?.last_error ? `❌ ${status.last_error}` : (status && status.last_count != null) ? `✓ 已同步 · ${status.last_count} 页` : "已连接 · 自动运行"}</span></div>
          <div className="sync-info">{status?.last_sync ? `上次同步: ${status.last_sync.replace("T", " ").slice(0, 19)}` : "检查更新中..."}</div>
          <div className="sync-on">✓ AI 自动命名已开启</div>
        </div>
      </div>
    );

    if (mod.id === 'vector') return (
      <div className="card" key={mod.id} style={{ cursor: 'default' }}>
        <div className="card-header"><span className="card-title">🗄️ 向量数据库</span><span className="badge green">✓</span></div>
        <div className="card-body">
          {(status?.collections || []).map(col => <div key={col} className="col-stat"><span className="col-name">{col}</span><span className="col-count">{status?.documents ?? "?"} 条</span></div>)}
          <div className="col-stat" style={{ marginTop: '8px' }}><span style={{ fontSize: '10px', color: '#94a3b8' }}>向量索引状态</span><span className="badge green">✓</span></div>
        </div>
      </div>
    );

    if (mod.id === 'logs') return (
      <div className="card" key={mod.id} style={{ cursor: 'default' }}>
        <div className="card-header"><span className="card-title">📋 最近日志</span><span className="card-more" onClick={() => window.open("http://localhost:5100/api/logs", "_blank")}>查看全部 →</span></div>
        <div className="card-body">
          <div className="log-list">
            {logs.length === 0 ? <div className="empty-state">暂无同步记录</div> :
              logs.slice(-6).reverse().map((line, i) => {
                const { time, title, badge, icon, bg } = parseLogLine(line);
                return <div key={i} className="log-item"><div className="log-icon" style={{ background: bg }}>{icon}</div><div className="log-content"><div className="log-title">{title}</div><div className="log-time">{time}</div></div><span className={`log-badge ${badge}`}>{badge === "ok" ? "成功" : badge === "err" ? "失败" : badge === "run" ? "进行中" : "信息"}</span></div>;
              })}
          </div>
        </div>
      </div>
    );

    if (mod.id === 'quick') return (
      <div className="card" key={mod.id} style={{ cursor: 'default' }}>
        <div className="card-header"><span className="card-title">⚡ 快捷操作</span></div>
        <div className="card-body">
          {[{ icon: "🔄", bg: "#f0fdf4", title: "同步 Notion", sub: "立即检查更新", action: doSync }, { icon: "🤖", bg: "#eef2ff", title: "AI 对话", sub: currentModel ? `当前: ${currentModel}` : "选择模型", action: () => router.push("/chat") }, { icon: "📋", bg: "#fef3c7", title: "查看日志", sub: "raw 日志文件", action: () => window.open("http://localhost:5100/api/logs", "_blank") }, { icon: "⚙️", bg: "#f1f5f9", title: "系统设置", sub: "模型 · 同步 · Notion", action: () => router.push("/settings") }].map(item => (
            <div key={item.title} className="quick-action-item" onClick={item.action}>
              <div className="qa-icon" style={{ background: item.bg }}>{item.icon}</div><div><div className="qa-title">{item.title}</div><div className="qa-sub">{item.sub}</div></div>
            </div>
          ))}
        </div>
      </div>
    );

    if (mod.id === 'notion') return (
      <div className="card" key={mod.id} style={{ cursor: 'default' }}>
        <div className="card-header"><span className="card-title">🗂️ Notion 数据库</span></div>
        <div className="card-body">
          {(status?.databases || []).map(db => <div key={db} className="db-item"><span className="db-name">📋 {db}</span><span style={{ fontSize: '10px', color: '#94a3b8' }}><span style={{ color: '#10b981', marginRight: '3px' }}>●</span>已连接</span></div>)}
        </div>
      </div>
    );

    if (mod.id === 'sys') return (
      <div className="card" key={mod.id} style={{ cursor: 'default' }}>
        <div className="card-header"><span className="card-title">⚙️ 系统状态</span></div>
        <div className="card-body sys-status">
          {[{ label: '本地模型', val: '正常', dot: 'green', ok: true }, { label: 'Notion API', val: '正常', dot: 'green', ok: true }, { label: '向量数据库', val: '正常', dot: 'green', ok: true }, { label: '同步服务', val: status?.service_running ? '运行中' : '已停止', dot: status?.service_running ? 'green' : 'yellow', ok: status?.service_running ?? false }].map(row => (
            <div key={row.label} className="status-row"><span className="status-label">{row.label}</span><span className={`status-val ${row.ok ? "ok" : "warn"}`}><span className={`dot ${row.dot}`}></span>{row.val}</span></div>
          ))}
        </div>
      </div>
    );

    return null;
  };

  // Layout: hero is always full-width at top. Remaining modules: left column | right column
  const leftModules = modules.filter(m => m.id !== 'hero' && m.col === 1);
  const rightModules = modules.filter(m => m.id !== 'hero' && m.col === 2);
  const heroModule = modules.find(m => m.id === 'hero');

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
          <div className="nav-item active" onClick={() => router.push("/")}><span>🏠</span> 概览</div>
          <div className="nav-item" onClick={() => router.push("/chat")}><span>💬</span> AI 对话</div>
          <div className="nav-item" onClick={() => router.push("/search")}><span>🔍</span> 搜索</div>
          <div className="nav-item" onClick={() => router.push("/settings")}><span>⚙️</span> 设置</div>
        </div>
        <div className="nav-section">
          <div className="nav-label">数据源</div>
          <div className="nav-item"><span>🗂️</span> Notion<span className="nav-dot green"></span></div>
          <div className="nav-item"><span>📁</span> 本地笔记<span className="nav-dot green"></span></div>
        </div>
        <div className="sidebar-footer">
          <div className="model-select-label">当前模型</div>
          <select className="model-select" value={models?.current || ""} onChange={async e => { try { await apiClient.setModel(e.target.value); const m = await apiClient.getModels(); setModels(m); } catch {} }}>
            {(models?.models || []).map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <h1>知识库概览</h1>
            <div className="subtitle">拖拽模块可自定义布局 · 实时同步状态</div>
          </div>
          <div className="topbar-right">
            <button className="btn-primary" onClick={doSync} disabled={syncing}><span>{syncing ? "⏳" : "⚡"}</span>{syncing ? "同步中..." : "一键同步全部"}</button>
            <div className="btn-icon" onClick={loadAll} title="刷新">↻</div>
          </div>
        </div>

        <div className="content">
          {/* Hero module */}
          {heroModule && (
            <DraggableModule id={heroModule.id} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} isDragOver={dragOverId === heroModule.id}>
              {renderModule(heroModule)}
            </DraggableModule>
          )}

          {/* Search results */}
          {showResults && (
            <div className="card slide-in" style={{ marginBottom: '16px' }}>
              <div className="card-header"><span className="card-title">🔍 搜索结果</span><span className="card-more" onClick={() => setShowResults(false)}>关闭</span></div>
              <div className="card-body">
                {searching ? <div className="empty-state">搜索中<span className="loading-dots">...</span></div> :
                  searchResults.length === 0 ? <div className="empty-state">没有找到相关结果</div> :
                    <div className="search-results">{searchResults.map((r, i) => <div key={i} className="search-result"><div className="search-result-title">📄 {r.title || "无标题"}</div><div className="search-result-meta">{r.database || r.source || ""}</div><div className="search-result-content">{r.content}</div></div>)}</div>}
              </div>
            </div>
          )}

          {/* Two-column layout for remaining modules */}
          <div className="main-grid">
            <div>
              {leftModules.map(mod => (
                <DraggableModule key={mod.id} id={mod.id} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} isDragOver={dragOverId === mod.id}>
                  <div style={{ marginBottom: '12px' }}>{renderModule(mod)}</div>
                </DraggableModule>
              ))}
            </div>
            <div>
              {rightModules.map(mod => (
                <DraggableModule key={mod.id} id={mod.id} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} isDragOver={dragOverId === mod.id}>
                  <div style={{ marginBottom: '12px' }}>{renderModule(mod)}</div>
                </DraggableModule>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
