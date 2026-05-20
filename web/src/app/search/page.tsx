"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type NoteItem } from "@/lib/api";
import type { ApiModels, SearchResult } from "@/lib/types";

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [models, setModels] = useState<ApiModels | null>(null);
  const [activeFilter, setActiveFilter] = useState("全部");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    async function init() {
      try {
        const [m, n] = await Promise.all([apiClient.getModels(), apiClient.getNotes()]);
        setModels(m);
        setNotes(n.notes || []);
      } catch {}
    }
    init();
  }, []);

  async function doSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const r = await apiClient.search(q, 20);
      setResults(r.results || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  async function loadNotes() {
    try {
      const n = await apiClient.getNotes();
      setNotes(n.notes || []);
    } catch {}
  }

  const filters = ["全部", ...Array.from(new Set(notes.map(n => n.database || "未分类")))];

  const filteredNotes = activeFilter === "全部"
    ? notes
    : notes.filter(n => n.database === activeFilter);

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark"><span>NX</span></div>
          <div><div className="logo-text">Nexus</div><div className="logo-sub">AI System · v3.1</div></div>
        </div>
        <div className="search-box"><span>🔍 搜索知识库...</span><span className="key">⌘K</span></div>
        <div className="nav-section">
          <div className="nav-label">Main</div>
          <div className="nav-item" onClick={() => router.push("/")}><span>🏠</span> 概览</div>
          <div className="nav-item" onClick={() => router.push("/chat")}><span>💬</span> AI 对话</div>
          <div className="nav-item" onClick={() => router.push("/calendar")}><span>📅</span> 日历 &amp; 复盘</div>
          <div className="nav-item active" onClick={() => router.push("/search")}><span>🔍</span> 搜索</div>
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
            <h1>🔍 知识搜索</h1>
            <div className="subtitle">共 {notes.length} 条笔记 · 实时从向量数据库读取</div>
          </div>
          <div className="topbar-right">
            <button className="btn-ghost" onClick={loadNotes} style={{ fontSize: 11 }}>
              ↻ 刷新知识库
            </button>
          </div>
        </div>

        <div className="content">
          {/* Search bar */}
          <div style={{ maxWidth: 640, marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 8, background: "var(--sb-surface)", border: "1.5px solid var(--sb-border)", borderRadius: 12, padding: "4px", transition: "border-color 0.1s" }}>
              <input ref={inputRef} type="text" placeholder="输入关键词搜索..."
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doSearch(query); }}
                style={{ flex: 1, border: "none", outline: "none", padding: "8px 12px", fontSize: 14, color: "var(--sb-text)", fontFamily: "inherit", background: "transparent" }} />
              <button className="btn-primary" onClick={() => doSearch(query)} disabled={loading || !query.trim()}>
                {loading ? "搜索中..." : "🔍 搜索"}
              </button>
            </div>

            {/* Filter tags */}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {filters.map(tag => (
                <span key={tag} onClick={() => { setActiveFilter(tag); setSearched(false); setQuery(""); }}
                  style={{ padding: "3px 10px", borderRadius: 9999, fontSize: 11, fontWeight: 500,
                    background: activeFilter === tag ? "var(--sb-ink)" : "var(--sb-muted)",
                    color: activeFilter === tag ? "white" : "var(--sb-text-secondary)",
                    cursor: "pointer" }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Search results */}
          {loading && <div className="empty-state">搜索中<span className="loading-dots">...</span></div>}

          {!loading && searched && results.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sb-ink)", marginBottom: 8 }}>没有找到相关结果</div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)" }}>尝试用不同的关键词，或先同步 Notion 数据</div>
            </div>
          )}

          {!loading && searched && results.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginBottom: 12 }}>找到 {results.length} 条相关结果</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {results.map((r, i) => (
                  <div key={i} className="card" style={{ cursor: "pointer" }}>
                    <div className="card-body">
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>📄</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sb-ink)" }}>{r.title || "无标题"}</div>
                          <div style={{ fontSize: 10, color: "var(--sb-text-muted)", marginTop: 2 }}>{r.database || r.source || ""} · 相关文档</div>
                          <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginTop: 6, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{r.content}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Real-time knowledge base display (when not searching) */}
          {!searched && (
            <div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginBottom: 12 }}>
                📚 知识库 · {filteredNotes.length} 条笔记{activeFilter !== "全部" ? ` · ${activeFilter}` : ""}
              </div>
              {filteredNotes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sb-ink)", marginBottom: 8 }}>暂无笔记</div>
                  <div style={{ fontSize: 12, color: "var(--sb-text-muted)" }}>先去同步 Notion 数据，或检查向量数据库状态</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {filteredNotes.map(note => (
                    <div key={note.id} className="card" style={{ cursor: "pointer" }}>
                      <div className="card-body">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>📄</div>
                          <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "var(--sb-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note.title}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--sb-text-muted)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{note.content}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                          <span className="badge blue" style={{ fontSize: 9 }}>{note.database || "笔记"}</span>
                          <span style={{ fontSize: 9, color: "var(--sb-text-muted)" }}>{note.updated ? note.updated.slice(0, 10) : ""}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
