"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Home, MessageSquare, Calendar, Search, Settings,
  Database, FolderOpen, ChevronDown, Check, BookOpen,
  PlusCircle, Circle, Trash2
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useDataSources, getChatSessions, deleteChatSession, useActiveModel, type ChatSession } from "@/lib/hooks";
import type { ApiModels, ApiStatus } from "@/lib/types";

// ─── Aimira Logo ──────────────────────────────────────────────
function AimiraLogo() {
  // 与官网 Logo 一致：紫→红渐变圆 + 居中白色镜心
  return (
    <div style={{
      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
      background: "var(--brand-gradient)",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 4px 12px -2px color-mix(in srgb, var(--brand-500) 60%, transparent)",
    }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: "#fff",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.04)",
      }} />
    </div>
  );
}

// ─── Model Dropdown ───────────────────────────────────────────
interface ModelGroup { label: string; provider: "local" | "online"; models: string[] }

function ModelDropdown({
  current, groups, onSelect,
}: {
  current: string;
  groups: ModelGroup[];
  onSelect: (m: string, provider: "local" | "online") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const allModels = groups.flatMap(g => g.models);
  const label = current || "选择模型...";
  const shortLabel = label.length > 22 ? label.slice(0, 19) + "…" : label;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--sb-muted)", border: "1px solid var(--sb-border)",
          borderRadius: 8, padding: "0 10px", fontSize: 12,
          color: "var(--sb-text-secondary)", cursor: "pointer",
          fontFamily: "inherit", gap: 4,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "center" }}>
          {shortLabel}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0,
          background: "white", border: "1px solid var(--sb-border)",
          borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          zIndex: 1000, overflow: "hidden", maxHeight: 280, overflowY: "auto",
        }}>
          {allModels.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 11, color: "var(--sb-text-muted)", textAlign: "center" }}>
              暂无模型 · 请在设置中配置
            </div>
          ) : (
            groups.map(group => (
              group.models.length > 0 ? (
                <div key={group.label}>
                  <div style={{
                    padding: "6px 12px 4px", fontSize: 9, fontWeight: 700,
                    color: "var(--sb-text-muted)", textTransform: "uppercase",
                    letterSpacing: "0.05em", background: "var(--sb-bg)",
                    borderBottom: "1px solid var(--sb-border)",
                  }}>
                    {group.label}
                  </div>
                  {group.models.map(m => (
                    <button key={m}
                      onClick={() => { onSelect(m, group.provider); setOpen(false); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 12px", border: "none", background: "none",
                        cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                        color: m === current ? "var(--sb-primary)" : "var(--sb-text-secondary)",
                        textAlign: "left",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--sb-muted)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m}</span>
                      {m === current && <Check size={12} style={{ flexShrink: 0, color: "var(--sb-primary)" }} />}
                    </button>
                  ))}
                </div>
              ) : null
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Spotlight 全局搜索（居中蒙层，参考 macOS Spotlight）──────────
function SpotlightSearch({ open, onClose, onNavigate }: {
  open: boolean; onClose: () => void; onNavigate: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [all, setAll] = useState<ChatSession[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setAll(getChatSessions());
      setQuery(""); setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 8);
    return all.filter(s =>
      (s.title || "").toLowerCase().includes(q) || (s.preview || "").toLowerCase().includes(q)
    ).slice(0, 12);
  })();

  useEffect(() => { setIndex(0); }, [query]);

  if (!open || typeof document === "undefined") return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); if (results[index]) onNavigate(results[index].id); }
  }

  // 渲染到 body，避免被 sidebar 的层叠上下文困住（z-index 被主内容盖住）
  return createPortal((
    <div className="spot-overlay" onClick={onClose}>
      <div className="spot-modal" onClick={e => e.stopPropagation()}>
        <div className="spot-input-row">
          <Search size={18} style={{ color: "var(--sb-text-muted)", flexShrink: 0 }} />
          <input ref={inputRef} className="spot-input" value={query}
            onChange={e => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder="搜索对话记录…" />
          <span className="spot-esc">esc</span>
        </div>
        <div className="spot-results">
          {results.length === 0 ? (
            <div className="spot-empty">{all.length === 0 ? "还没有对话记录" : "没有匹配的对话"}</div>
          ) : (
            <>
              {!query.trim() && <div className="spot-section">最近对话</div>}
              {results.map((s, i) => (
                <button key={s.id} className={`spot-item${i === index ? " active" : ""}`}
                  onMouseEnter={() => setIndex(i)} onClick={() => onNavigate(s.id)}>
                  <MessageSquare size={15} className="spot-item-icon" />
                  <span className="spot-item-main">
                    <span className="spot-item-title">{s.title || "未命名对话"}</span>
                    <span className="spot-item-prev">{s.preview}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}

// ─── Main Sidebar ─────────────────────────────────────────────
interface SidebarProps {
  activePage: "home" | "chat" | "calendar" | "search" | "settings";
}

const NAV = [
  { id: "home", label: "概览", icon: Home, href: "/" },
  { id: "chat", label: "AI 对话", icon: MessageSquare, href: "/chat" },
  { id: "calendar", label: "复盘日历", icon: Calendar, href: "/calendar" },
  { id: "search", label: "知识库", icon: BookOpen, href: "/search" },
] as const;

export default function Sidebar({ activePage }: SidebarProps) {
  const router = useRouter();
  const [models, setModels] = useState<ApiModels | null>(null);
  const { active, select } = useActiveModel();
  const [onlineModels, setOnlineModels] = useState<string[]>([]);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [mounted, setMounted] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sourceToast, setSourceToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sources, toggle } = useDataSources();

  // 仅在客户端挂载后读取 localStorage，避免 SSR/CSR 水合不匹配
  useEffect(() => {
    setMounted(true);
    setSessions(getChatSessions());
  }, []);

  function handleDeleteSession(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    deleteChatSession(id);
    setSessions(getChatSessions());
  }

  function handleToggleSource(id: string, name: string, wasActive: boolean) {
    toggle(id);
    setSourceToast(wasActive ? `已手动断开「${name}」` : `已连接「${name}」`);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setSourceToast(""), 2200);
  }

  const loadModels = useCallback(async () => {
    try {
      const m = await apiClient.getModels();
      setModels(m);
    } catch {}
    try {
      const st = await apiClient.getStatus();
      setStatus(st);
      setNotionError(null); // 后端可达即视为正常（last_error 可能是历史同步残留，不作连接错误判断）
    } catch (e) { setNotionError(e instanceof Error ? e.message : "无法连接后端服务"); }
    // Load cached online models from localStorage
    try {
      const cached = localStorage.getItem("aimira-online-models");
      if (cached) setOnlineModels(JSON.parse(cached));
    } catch {}
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { loadModels(); }, []);

  // ⌘K / Ctrl+K 打开 Spotlight 搜索
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSpotlightOpen(v => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function handleSearchNav(sessionId: string) {
    setSpotlightOpen(false);
    router.push(`/chat?session=${sessionId}`);
  }

  const localModels = models?.models || [];
  const modelGroups: ModelGroup[] = [
    { label: "本地", provider: "local", models: localModels },
    { label: "线上", provider: "online", models: onlineModels },
  ];

  const recentSessions = sessions.slice(0, 20);

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <AimiraLogo />
        <div>
          <div className="logo-text">Aimira</div>
          <div className="logo-sub">明镜见心 · v3.1</div>
        </div>
      </div>

      {/* Search (Chat History) → 居中 Spotlight 蒙层 */}
      <div style={{ margin: "0 16px 16px" }}>
        <button
          className="search-box"
          style={{ margin: 0, cursor: "text", width: "100%", textAlign: "left" }}
          onClick={() => setSpotlightOpen(true)}
        >
          <Search size={12} style={{ flexShrink: 0, color: "var(--sb-text-muted)" }} />
          <span style={{ flex: 1, fontSize: 11, color: "var(--sb-text-muted)" }}>搜索对话记录...</span>
          <span className="key">⌘K</span>
        </button>
      </div>

      <SpotlightSearch open={spotlightOpen} onClose={() => setSpotlightOpen(false)} onNavigate={handleSearchNav} />

      {/* Nav */}
      <div className="nav-section">
        <div className="nav-label">MAIN</div>
        {NAV.map(item => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className={`nav-item${activePage === item.id ? " active" : ""}`}
              onClick={() => router.push(item.href)}
            >
              <Icon size={14} />
              {item.label}
            </div>
          );
        })}
      </div>

      {/* Data Sources */}
      <div className="nav-section">
        <div className="nav-label">SOURCES</div>
        {mounted && sources.map(src => {
          const Icon = src.type === "notion" ? Database : src.type === "local" ? FolderOpen : Circle;
          // 本地笔记：未配置目录 / 目录无效 → 视为未连接（不可亮绿）
          const localUnconfigured = src.type === "local" && status != null && !status.local_notes_connected;
          const errored = src.active && src.type === "notion" && !!notionError;
          // 三态：连接=绿 / 断开=黄 / 错误=红
          const state: "connected" | "disconnected" | "error" =
            errored ? "error" : (src.active && !localUnconfigured) ? "connected" : "disconnected";
          const lightColor = state === "connected" ? "#10b981" : state === "error" ? "#ef4444" : "#f59e0b";
          const lightGlow = state === "connected" ? "rgba(16,185,129,0.25)" : state === "error" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)";
          const tip = state === "error" ? `连接错误：${notionError}（点击重试/断开）`
            : localUnconfigured ? (status?.local_notes_path ? `本地笔记目录无效：${status.local_notes_path}（请在设置中修改）` : `未设置本地笔记目录 · 请到设置中配置后才会连接`)
            : state === "connected" ? `已连接 · AI 对话会搜索「${src.name}」（点击断开）`
            : `已断开 · AI 对话不会搜索此源（点击连接）`;
          return (
            <div key={src.id} className="nav-item" style={{ justifyContent: "space-between", cursor: "pointer" }}
              title={tip}
              onClick={() => { if (src.type === "local" && localUnconfigured) { router.push("/settings#sources"); return; } handleToggleSource(src.id, src.name, src.active); }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <Icon size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {src.name}
                </span>
              </div>
              <span
                style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: lightColor, flexShrink: 0,
                  boxShadow: `0 0 0 3px ${lightGlow}`, transition: "all 0.2s",
                }}
              />
            </div>
          );
        })}
        <div
          className="nav-item"
          onClick={() => router.push("/settings#sources")}
          style={{ opacity: 0.6 }}
        >
          <PlusCircle size={13} />
          <span style={{ fontSize: 11 }}>添加数据源</span>
        </div>
      </div>

      {/* Recent */}
      {mounted && recentSessions.length > 0 && (
        <div className="nav-section recent-section">
          <div className="nav-label">RECENT</div>
          <div className="recent-scroll">
            {recentSessions.map(s => (
              <div key={s.id} className="recent-chat" onClick={() => router.push(`/chat?session=${s.id}`)}>
                <div className="recent-chat-icon"><MessageSquare size={13} /></div>
                <div className="recent-chat-body">
                  <div className="recent-chat-title">{s.title || "未命名对话"}</div>
                  <div className="recent-chat-preview">{s.preview || "暂无预览"}</div>
                </div>
                <button
                  className="recent-del"
                  title="删除此对话"
                  onClick={e => handleDeleteSession(e, s.id)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer: Model card（mount 后再渲染，避免 SSR/CSR 模型名不一致） */}
      <div className="sidebar-footer">
        <div className="model-footer-card">
          {mounted ? (
            <>
              <div className="model-footer-row">
                <span className="model-status-dot" title="已连接" />
                <div className="model-footer-main">
                  <ModelDropdown current={active.model} groups={modelGroups} onSelect={select} />
                </div>
                <button className="model-footer-settings" onClick={() => router.push("/settings")} title="设置">
                  <Settings size={14} />
                </button>
              </div>
              <div className="model-footer-sub">{active.provider === "online" ? "线上 API" : "本地 GPU"}</div>
            </>
          ) : (
            <>
              <div className="model-footer-row model-footer-skeleton">
                <span className="model-status-dot" style={{ opacity: 0.4 }} />
                <div className="model-footer-main">
                  <div className="model-footer-placeholder">选择模型...</div>
                </div>
              </div>
              <div className="model-footer-sub">本地 GPU</div>
            </>
          )}
        </div>
      </div>

      {sourceToast && (
        <div className="source-toast">
          <Check size={13} /> {sourceToast}
        </div>
      )}
    </aside>
  );
}
