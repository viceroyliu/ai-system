"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api";
import type { ApiModels, SearchResult } from "@/lib/types";

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [models, setModels] = useState<ApiModels | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    apiClient.getModels().then(setModels).catch(() => {});
  }, []);

  async function doSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const r = await apiClient.search(q, 10);
      setResults(r.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") doSearch(query);
  }

  return (
    <div className="app-layout">
      {/* ====== SIDEBAR ====== */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark"><span>SB</span></div>
          <div>
            <div className="logo-text">SecondBrain</div>
            <div className="logo-sub">AI System · v3.0</div>
          </div>
        </div>

        <div className="search-box">
          <span>🔍 搜索知识库...</span>
          <span className="key">⌘K</span>
        </div>

        <div className="nav-section">
          <div className="nav-label">Main</div>
          <div className="nav-item" onClick={() => router.push("/")}>
            <span>🏠</span> 概览
          </div>
          <div className="nav-item" onClick={() => router.push("/chat")}>
            <span>💬</span> AI 对话
          </div>
          <div className="nav-item active">
            <span>🔍</span> 搜索
          </div>
          <div className="nav-item" onClick={() => router.push("/settings")}>
            <span>⚙️</span> 设置
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-label">数据源</div>
          <div className="nav-item">
            <span>🗂️</span> Notion
            <span className="nav-dot green"></span>
          </div>
          <div className="nav-item">
            <span>📁</span> 本地笔记
            <span className="nav-dot green"></span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="model-select-label">当前模型</div>
          <select
            className="model-select"
            value={models?.current || ""}
            onChange={async (e) => {
              try {
                await apiClient.setModel(e.target.value);
                const m = await apiClient.getModels();
                setModels(m);
              } catch {}
            }}
          >
            {(models?.models || []).map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </aside>

      {/* ====== MAIN ====== */}
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <h1>🔍 知识搜索</h1>
            <div className="subtitle">在所有笔记、Notion 页面和向量数据库中搜索</div>
          </div>
        </div>

        <div className="content">
          {/* Search bar */}
          <div style={{ maxWidth: "640px", marginBottom: "24px" }}>
            <div style={{
              display: "flex",
              gap: "8px",
              background: "var(--sb-surface)",
              border: "1.5px solid var(--sb-border)",
              borderRadius: "12px",
              padding: "4px",
              transition: "border-color 0.1s",
            }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="输入关键词搜索..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  padding: "8px 12px",
                  fontSize: "14px",
                  color: "var(--sb-text)",
                  fontFamily: "inherit",
                  background: "transparent",
                }}
              />
              <button
                className="btn-primary"
                onClick={() => doSearch(query)}
                disabled={loading || !query.trim()}
              >
                {loading ? "搜索中..." : "🔍 搜索"}
              </button>
            </div>

            {/* Quick filters */}
            <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
              {["全部", "Notion", "本地笔记", "AI笔记", "复盘", "闪念"].map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "3px 10px",
                    borderRadius: "9999px",
                    fontSize: "11px",
                    fontWeight: "500",
                    background: tag === "全部" ? "var(--sb-ink)" : "var(--sb-muted)",
                    color: tag === "全部" ? "white" : "var(--sb-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Results */}
          {loading && (
            <div className="empty-state">
              正在搜索<span className="loading-dots">...</span>
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
              <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--sb-ink)", marginBottom: "8px" }}>
                没有找到相关结果
              </div>
              <div style={{ fontSize: "12px", color: "var(--sb-text-muted)" }}>
                尝试用不同的关键词，或先同步 Notion 数据
              </div>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div>
              <div style={{ fontSize: "12px", color: "var(--sb-text-muted)", marginBottom: "12px" }}>
                找到 {results.length} 条相关结果
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {results.map((r, i) => (
                  <div
                    key={i}
                    className="card"
                    style={{ cursor: "pointer" }}
                    onClick={() => {}}
                  >
                    <div className="card-body">
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                        <div style={{
                          width: "32px", height: "32px", borderRadius: "8px",
                          background: "#eef2ff", display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "14px", flexShrink: 0,
                        }}>
                          📄
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--sb-ink)" }}>
                            {r.title || "无标题"}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--sb-text-muted)", marginTop: "2px" }}>
                            {r.database || r.source || ""} · 相关文档
                          </div>
                          <div style={{
                            fontSize: "12px", color: "var(--sb-text-muted)",
                            marginTop: "6px", lineHeight: "1.5",
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                          }}>
                            {r.content}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!searched && !loading && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔍</div>
              <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--sb-ink)", marginBottom: "8px" }}>
                开始搜索知识库
              </div>
              <div style={{ fontSize: "12px", color: "var(--sb-text-muted)" }}>
                输入关键词，从 {">"} 条笔记中找到相关内容
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
