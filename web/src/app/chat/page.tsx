"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type ChatResponse, type NoteItem } from "@/lib/api";
import type { ApiModels, SearchResult } from "@/lib/types";

function buildId() { return Math.random().toString(36).slice(2, 10); }

function formatTime(d: Date) { return d.toTimeString().slice(0, 5); }

interface ChatMsg {
  id: string; role: 'user' | 'assistant'; content: string;
  timestamp: Date; sources?: SearchResult[]; model?: string;
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ApiModels | null>(null);
  const [currentModel, setCurrentModel] = useState("");
  const [kbCount, setKbCount] = useState<number | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      try {
        const [m, s, n] = await Promise.all([
          apiClient.getModels(),
          apiClient.getStatus(),
          apiClient.getNotes(),
        ]);
        setModels(m); setCurrentModel(m.current || "");
        setKbCount(s.documents);
        setNotes(n.notes || []);
        // 生成 AI 推荐问题
        generateAISuggestions(n.notes || []);
      } catch {}
    }
    init();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function generateAISuggestions(noteItems: NoteItem[]) {
    if (!noteItems.length) {
      setSuggestions(["本周复盘应该关注哪些方面？", "我的知识体系有哪些盲点？", "推荐一个适合当前阶段的项目"]);
      return;
    }
    // 取标题列表构造 prompt 让模型推荐问题
    const titles = noteItems.slice(0, 10).map(n => n.title).join("、");
    try {
      const lmCfg = models?.current || "";
      const resp = await apiClient.chat(
        `基于以下笔记标题，生成 3 个用户可能会问的问题（只输出问题，中文，简洁）：\n${titles}`,
        lmCfg
      );
      // 解析回复，每行一个问题
      const lines = resp.answer.split('\n').filter(l => l.trim());
      const qs = lines.slice(0, 3).map(l => l.replace(/^[\d.、]+/, '').trim()).filter(l => l.length > 5 && l.length < 50);
      setSuggestions(qs.length >= 3 ? qs : ["本周复盘应该关注哪些方面？", "我的知识体系有哪些盲点？", "推荐一个适合当前阶段的项目"]);
    } catch {
      setSuggestions(["本周复盘应该关注哪些方面？", "我的知识体系有哪些盲点？", "推荐一个适合当前阶段的项目"]);
    }
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || loading) return;
    const userMsg: ChatMsg = { id: buildId(), role: "user", content: q, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setSuggestions([]); // 发送后清空建议

    try {
      const resp: ChatResponse = await apiClient.chat(q, currentModel);
      const aiMsg: ChatMsg = {
        id: buildId(), role: "assistant", content: resp.answer,
        timestamp: new Date(), sources: resp.sources || [], model: resp.model || currentModel,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (e: unknown) {
      const aiMsg: ChatMsg = {
        id: buildId(), role: "assistant",
        content: `请求失败: ${e instanceof Error ? e.message : String(e)}。请确认 LM Studio 已加载模型。`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; }
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
          <div className="nav-item active" onClick={() => router.push("/chat")}><span>💬</span> AI 对话</div>
          <div className="nav-item" onClick={() => router.push("/calendar")}><span>📅</span> 日历 &amp; 复盘</div>
          <div className="nav-item" onClick={() => router.push("/search")}><span>🔍</span> 搜索</div>
          <div className="nav-item" onClick={() => router.push("/settings")}><span>⚙️</span> 设置</div>
        </div>
        <div className="nav-section">
          <div className="nav-label">知识库</div>
          {notes.slice(0, 5).map(n => (
            <div key={n.id} className="nav-item" style={{ fontSize: "11px", padding: "4px 8px" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {n.title}</span>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="model-select-label">当前模型</div>
          <select className="model-select" value={currentModel} onChange={async e => { try { await apiClient.setModel(e.target.value); const m = await apiClient.getModels(); setModels(m); setCurrentModel(m.current || ""); } catch {} }}>
            {(models?.models || []).map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>
      </aside>

      {/* MAIN CHAT */}
      <main className="chat-main">
        <div className="chat-topbar">
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>💬</div>
          <div className="chat-title-wrap">
            <div className="chat-title">新对话</div>
            <div className="chat-meta">{messages.length} 条 · {kbCount ?? "—"} 笔记已索引 · {currentModel || "—"}</div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 11, padding: "6px 12px" }}>🔗 分享</button>
          <button className="btn-primary" style={{ fontSize: 11, padding: "6px 12px" }}>⚡ 同步到 Notion</button>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--sb-ink)", marginBottom: 8 }}>你好，我是 Nexus AI</div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginBottom: 20 }}>基于你的 {kbCount ?? "—"} 条笔记和向量数据库回答</div>

              {/* AI-generated suggestions */}
              {suggestions.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 500, margin: "0 auto" }}>
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                      style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 9999, padding: "6px 14px", fontSize: 12, color: "#4338ca", cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
                      → {s}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ background: "#ede9fe", borderRadius: 14, padding: 16, maxWidth: 500, margin: "20px auto 0", textAlign: "left" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6d28d9", marginBottom: 8 }}>💡 开始探索</div>
                <div style={{ fontSize: 11, color: "#5b21b6" }}>试试问：React Hooks 最佳实践、如何做周复盘、我的学习方法有什么问题</div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="chat-msg">
              <div className={`msg-avatar ${msg.role === "user" ? "user" : "ai"}`}>{msg.role === "user" ? "A" : "AI"}</div>
              <div className="msg-content">
                <span className="msg-role">{msg.role === "user" ? "You" : "Nexus AI"}</span>
                <span className="msg-time">{formatTime(msg.timestamp)}{msg.model ? ` · ${msg.model}` : ""}</span>
                <div className="msg-text">{msg.content}</div>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="sources-section">
                    <div className="sources-title">📎 引用了 {msg.sources.length} 个来源</div>
                    {msg.sources.slice(0, 4).map((src, i) => <span key={i} className="source-chip">📄 {src.title || "无标题"}</span>)}
                    {msg.sources.length > 4 && <span className="source-chip" style={{ color: "var(--sb-primary)" }}>+ {msg.sources.length - 4} more</span>}
                  </div>
                )}

                {msg.role === "assistant" && suggestions.length > 0 && (
                  <div className="suggestions">
                    {suggestions.slice(0, 3).map(s => (
                      <button key={s} onClick={() => { setInput(s); textareaRef.current?.focus(); }} className="suggestion-btn">→ {s}</button>
                    ))}
                  </div>
                )}

                <div className="msg-actions">
                  {["📥 存入 Notion", "🔄 重新生成", "📋 复制"].map(label => <button key={label} className="msg-action-btn">{label}</button>)}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-msg">
              <div className="msg-avatar ai">AI</div>
              <div className="msg-content">
                <span className="msg-role">Nexus AI</span>
                <div className="msg-text" style={{ color: "var(--sb-text-muted)" }}>思考中<span className="loading-dots">...</span></div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-area">
          <div className="chat-input-wrap">
            <textarea ref={textareaRef} className="chat-input" placeholder="问点什么…（输入 @ 引用笔记，/ 调用命令）"
              value={input} onChange={e => { setInput(e.target.value); autoResize(); }} onKeyDown={handleKeyDown} rows={1}
              style={{ height: `${Math.min(textareaRef.current?.scrollHeight || 48, 200)}px` }} />
            <div className="chat-input-toolbar">
              <button className="chat-tool-btn">📎 附件</button>
              <button className="chat-tool-btn">🧠 知识库</button>
              <button className="chat-tool-btn">🗂️ Notion</button>
              <button className="chat-tool-btn">⚡ /命令</button>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--sb-text-muted)" }}>{kbCount ?? "—"} 笔记已索引</span>
              <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim() || loading}>↑</button>
            </div>
          </div>
        </div>
      </main>

      {/* RIGHT CONTEXT PANEL */}
      <aside className="context-panel">
        <div className="context-header">
          <div className="context-title">🎯 Context 上下文</div>
          <div className="context-auto-badge"><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>Auto</div>
          <div className="context-subtitle">AI 会自动加载相关笔记参与回答</div>
        </div>

        <div className="context-section">
          <div className="context-section-label">📚 KNOWLEDGE BASE</div>
          {notes.slice(0, 3).map(n => (
            <div key={n.id} className="kb-card" style={{ marginBottom: 8 }}>
              <div className="kb-card-title">{n.title}</div>
              <div className="kb-card-meta">{n.database || "笔记"} · {n.updated ? n.updated.slice(0, 10) : "最近"}</div>
              <div className="kb-injected-badge"><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#6ee7b7", display: "inline-block" }}></span>已注入对话</div>
            </div>
          ))}
          {notes.length === 0 && <div style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>暂无笔记，先同步 Notion</div>}
        </div>

        <div className="context-section">
          <div className="context-section-label">🤖 AI 推荐补充</div>
          <div className="ai-rec-card">
            <div className="ai-rec-title">这个话题还可以参考：</div>
            <div className="ai-rec-items">
              {notes.slice(0, 2).map(n => <>• {n.title}<br /></>)}
            </div>
            <button className="ai-rec-add-btn">+ 加入对话</button>
          </div>
        </div>

        <div className="context-section">
          <div className="context-section-label">🗂️ NOTION PAGES</div>
          {notes.slice(0, 4).map(n => (
            <div key={n.id} className="notion-page-item">
              <div className="notion-page-icon">📄</div>
              <div className="notion-page-name">{n.title}</div>
              <div className="notion-page-time">{n.updated ? n.updated.slice(5, 10).replace(/-/g, '/') : ""}</div>
            </div>
          ))}
        </div>

        <div className="context-section">
          <div className="context-section-label">⚙️ SETTINGS</div>
          <div className="setting-row"><span>温度（创造性）</span><span className="setting-val">0.7</span></div>
          <div className="setting-row"><span>引用模式</span><span className="setting-val">自动</span></div>
          <div className="setting-row"><span>当前模型</span><span className="setting-val" style={{ fontSize: 10 }}>{currentModel || "—"}</span></div>
        </div>
      </aside>
    </div>
  );
}
