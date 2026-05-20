"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api";
import type { ApiModels, SearchResult, ChatMessage } from "@/lib/types";

function formatTime(d: Date) {
  return d.toTimeString().slice(0, 5);
}

function buildId() {
  return Math.random().toString(36).slice(2, 10);
}

const SUGGESTIONS = [
  "本周复盘应该关注哪些方面？",
  "我的知识体系有哪些盲点？",
  "推荐一个适合当前阶段的项目",
  "如何高效整理技术笔记？",
];

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ApiModels | null>(null);
  const [currentModel, setCurrentModel] = useState("");
  const [kbCount, setKbCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [inputHeight, setInputHeight] = useState(48);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      try {
        const [m, s] = await Promise.all([
          apiClient.getModels(),
          apiClient.getStatus(),
        ]);
        setModels(m);
        setCurrentModel(m.current || "");
        setKbCount(s.documents);
      } catch {}
    }
    init();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const q = input.trim();
    if (!q) return;

    const userMsg: ChatMessage = {
      id: buildId(),
      role: "user",
      content: q,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setInputHeight(48);

    // Search for relevant knowledge
    let sources: SearchResult[] = [];
    try {
      const r = await apiClient.search(q, 5);
      sources = r.results || [];
    } catch {}

    // Simulated AI response (placeholder — real LLM call via /api/chat to be added)
    const aiMsg: ChatMessage = {
      id: buildId(),
      role: "assistant",
      content: buildAnswer(q, sources),
      timestamp: new Date(),
      sources,
      model: currentModel,
    };

    setMessages((prev) => [...prev, aiMsg]);
  }

  function buildAnswer(question: string, sources: SearchResult[]): string {
    if (sources.length === 0) {
      return `我目前没有找到与"${question}"直接相关的笔记。\n\n你可以尝试：\n• 调整问题措辞\n• 先同步 Notion 数据\n• 在 Notion 中添加相关笔记`;
    }

    const topSources = sources.slice(0, 3);
    const summary = topSources
      .map((s) => `• ${s.title || "无标题"}\n  ${(s.content || "").slice(0, 80)}...`)
      .join("\n\n");

    return `基于你的知识库，我找到了 ${sources.length} 条相关内容：\n\n${summary}\n\n——\n\n这是基于向量相似度的检索结果。如果需要更深入的回答，建议在设置中切换到更强的模型（如 qwen3:32b 或 deepseek-coder）。`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      const newH = Math.min(el.scrollHeight, 200);
      setInputHeight(newH);
      el.style.height = `${newH}px`;
    }
  }

  function appendSuggestion(s: string) {
    setInput(s);
    setTimeout(() => textareaRef.current?.focus(), 0);
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

        <div className="search-box" onClick={() => router.push("/search")}>
          <span>🔍 搜索知识库...</span>
          <span className="key">⌘K</span>
        </div>

        <div className="nav-section">
          <div className="nav-label">Main</div>
          <div className="nav-item" onClick={() => router.push("/")}>
            <span>🏠</span> 概览
          </div>
          <div className="nav-item active">
            <span>💬</span> AI 对话
          </div>
          <div className="nav-item" onClick={() => router.push("/search")}>
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

        <div className="nav-section">
          <div className="nav-label">最近对话</div>
          <div className="nav-item" style={{ fontSize: "11px", padding: "5px 8px", color: "#94a3b8" }}>
            暂无对话记录
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="model-select-label">当前模型</div>
          <select
            className="model-select"
            value={currentModel}
            onChange={async (e) => {
              try {
                await apiClient.setModel(e.target.value);
                const m = await apiClient.getModels();
                setModels(m);
                setCurrentModel(m.current || "");
              } catch {}
            }}
          >
            {(models?.models || []).map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </aside>

      {/* ====== MAIN CHAT ====== */}
      <main className="chat-main">
        {/* Top bar */}
        <div className="chat-topbar">
          <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>
            💬
          </div>
          <div className="chat-title-wrap">
            <div className="chat-title">新对话</div>
            <div className="chat-meta">
              {messages.length} 条消息 · {kbCount ?? "—"} 条笔记已索引
              {currentModel ? ` · ${currentModel}` : ""}
            </div>
          </div>
          <button className="btn-ghost" style={{ fontSize: "11px", padding: "6px 12px" }}>
            🔗 分享
          </button>
          <button className="btn-primary" style={{ fontSize: "11px", padding: "6px 12px" }}>
            ⚡ 同步到 Notion
          </button>
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {messages.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: "40px" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>🤖</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--sb-ink)", marginBottom: "8px" }}>
                你好，我是 SecondBrain AI
              </div>
              <div style={{ fontSize: "12px", color: "var(--sb-text-muted)", marginBottom: "20px" }}>
                基于你的 {kbCount ?? "—"} 条笔记和向量数据库回答
              </div>

              {/* Suggestions */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", maxWidth: "500px", margin: "0 auto" }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => appendSuggestion(s)}
                    style={{
                      background: "#eef2ff",
                      border: "1px solid #c7d2fe",
                      borderRadius: "9999px",
                      padding: "6px 14px",
                      fontSize: "12px",
                      color: "#4338ca",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontWeight: "500",
                    }}
                  >
                    → {s}
                  </button>
                ))}
              </div>

              {/* AI suggestion card */}
              <div style={{ background: "#ede9fe", borderRadius: "14px", padding: "16px", maxWidth: "500px", margin: "20px auto 0", textAlign: "left" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: "#6d28d9", marginBottom: "8px" }}>
                  🤖 AI 推荐
                </div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#4c1d95", marginBottom: "6px" }}>
                  尝试问一些关于你笔记内容的问题
                </div>
                <div style={{ fontSize: "11px", color: "#5b21b6" }}>
                  比如："React Hooks 的最佳实践"、"如何做周复盘"、"我的学习方法有什么问题"
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="chat-msg">
              <div className={`msg-avatar ${msg.role === "user" ? "user" : "ai"}`}>
                {msg.role === "user" ? "A" : "AI"}
              </div>
              <div className="msg-content">
                <span className="msg-role">{msg.role === "user" ? "You" : "SecondBrain"}</span>
                <span className="msg-time">
                  {formatTime(msg.timestamp)}
                  {msg.model ? ` · ${msg.model}` : ""}
                </span>
                <div className="msg-text">{msg.content}</div>

                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="sources-section">
                    <div className="sources-title">📎 引用了 {msg.sources.length} 个来源</div>
                    {msg.sources.slice(0, 4).map((src, i) => (
                      <span key={i} className="source-chip">📄 {src.title || "无标题"}</span>
                    ))}
                    {msg.sources.length > 4 && (
                      <span className="source-chip" style={{ color: "var(--sb-primary)" }}>
                        + {msg.sources.length - 4} more
                      </span>
                    )}
                  </div>
                )}

                {/* Suggestions */}
                {msg.role === "assistant" && (
                  <div className="suggestions">
                    {SUGGESTIONS.slice(0, 3).map((s) => (
                      <button
                        key={s}
                        onClick={() => appendSuggestion(s)}
                        className="suggestion-btn"
                      >
                        → {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="msg-actions">
                  {["📥 存入 Notion", "🔄 重新生成", "📋 复制"].map((label) => (
                    <button key={label} className="msg-action-btn">{label}</button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="chat-input-area">
          <div className="chat-input-wrap">
            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder="问点什么…（输入 @ 引用笔记，/ 调用命令）"
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(); }}
              onKeyDown={handleKeyDown}
              rows={1}
              style={{ height: `${inputHeight}px` }}
            />
            <div className="chat-input-toolbar">
              <button className="chat-tool-btn">📎 附件</button>
              <button className="chat-tool-btn">🧠 知识库</button>
              <button className="chat-tool-btn">🗂️ Notion</button>
              <button className="chat-tool-btn">⚡ /命令</button>
              <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--sb-text-muted)" }}>
                {kbCount ?? "—"} 笔记已索引
              </span>
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ====== RIGHT CONTEXT PANEL ====== */}
      <aside className="context-panel">
        <div className="context-header">
          <div className="context-title">🎯 Context 上下文</div>
          <div className="context-auto-badge">
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
            Auto
          </div>
          <div className="context-subtitle">AI 会自动加载相关笔记参与回答</div>
        </div>

        {/* Knowledge Base */}
        <div className="context-section">
          <div className="context-section-label">📚 KNOWLEDGE BASE</div>
          <div className="kb-card">
            <div className="kb-card-title">React 学习集合</div>
            <div className="kb-card-meta">{kbCount ?? "—"} 篇笔记 · 上次更新不久</div>
            <div className="kb-injected-badge">
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#6ee7b7", display: "inline-block" }}></span>
              已注入对话
            </div>
          </div>
        </div>

        {/* AI Recommendation */}
        <div className="context-section">
          <div className="context-section-label">🤖 AI 推荐补充</div>
          <div className="ai-rec-card">
            <div className="ai-rec-title">这个话题还可以参考：</div>
            <div className="ai-rec-items">
              • 《前端架构演进》笔记<br />
              • hooks 心智模型
            </div>
            <button className="ai-rec-add-btn">+ 加入对话</button>
          </div>
        </div>

        {/* Notion Pages */}
        <div className="context-section">
          <div className="context-section-label">🗂️ NOTION PAGES</div>
          {[
            { name: "周复盘 - Week 20", time: "2 小时前" },
            { name: "前端进阶路线图", time: "昨天" },
            { name: "React Hooks 实战", time: "3 天前" },
          ].map((p) => (
            <div key={p.name} className="notion-page-item">
              <div className="notion-page-icon">📄</div>
              <div className="notion-page-name">{p.name}</div>
              <div className="notion-page-time">{p.time}</div>
            </div>
          ))}
        </div>

        {/* Local Notes */}
        <div className="context-section">
          <div className="context-section-label">📁 LOCAL NOTES</div>
          {[
            { name: "hooks-deep-dive.md", path: "~/notes/react/", time: "1 天前" },
            { name: "useEffect 实战.md", path: "~/notes/react/", time: "2 天前" },
          ].map((f) => (
            <div key={f.name} className="notion-page-item">
              <div className="notion-page-icon" style={{ background: "#fef3c7" }}>📝</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="notion-page-name">{f.name}</div>
                <div style={{ fontSize: "9px", color: "var(--sb-text-muted)" }}>{f.path} · {f.time}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Settings */}
        <div className="context-section">
          <div className="context-section-label">⚙️ SETTINGS</div>
          <div className="setting-row">
            <span>温度（创造性）</span>
            <span className="setting-val">0.7</span>
          </div>
          <div className="setting-row">
            <span>引用模式</span>
            <span className="setting-val">自动</span>
          </div>
        </div>

        {/* Sync Status */}
        <div className="context-section">
          <div className="sync-status-card">
            <div className="sync-status-card-title">✓ 自动同步已启用</div>
            <div className="sync-status-item">• 每 5 分钟检查更新</div>
            <div className="sync-status-item">• AI 自动生成标题</div>
            <div className="sync-status-item">• 上次同步：刚刚</div>
            <button className="sync-now-btn" onClick={async () => { setSyncing(true); await apiClient.sync(); setSyncing(false); }}>
              ⚡ 立即同步
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
