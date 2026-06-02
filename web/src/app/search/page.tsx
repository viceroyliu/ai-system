"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, RefreshCw, FileText, Loader2, MoreHorizontal,
  Trash2, X, Calendar, Tag, Filter, ChevronDown, Plus,
  AlertTriangle, MessageSquarePlus,
} from "lucide-react";
import { apiClient, type NoteItem, type NoteDetail } from "@/lib/api";
import type { SearchResult } from "@/lib/types";
import Sidebar from "@/components/Sidebar";

// ─── localStorage filter persistence ─────────────────────
const FILTER_KEY = "ai_search_filters";
interface SavedFilters { activeFilter: string; activeStatus: string; activeTime: string; activeTag: string; }
function loadFilters(): SavedFilters {
  const defaults: SavedFilters = { activeFilter: "全部", activeStatus: "全部", activeTime: "全部", activeTag: "全部" };
  if (typeof window === "undefined") return defaults;
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") }; }
  catch { return defaults; }
}

function fmtDate(s: string) { return s ? s.slice(0, 10) : ""; }

// ─── 闪念分类标签配色：每个标签不同颜色（已知标签固定色，其余按名称哈希取色）──
const TAG_PALETTE: { bg: string; fg: string; solid: string }[] = [
  { bg: "#eff6ff", fg: "#1d4ed8", solid: "#3b82f6" }, // 蓝
  { bg: "#f0fdf4", fg: "#15803d", solid: "#16a34a" }, // 绿
  { bg: "#fdf2f8", fg: "#be185d", solid: "#db2777" }, // 粉
  { bg: "#f5f3ff", fg: "#6d28d9", solid: "#7c3aed" }, // 紫
  { bg: "#ecfeff", fg: "#0e7490", solid: "#06b6d4" }, // 青
  { bg: "#fff7ed", fg: "#c2410c", solid: "#ea580c" }, // 橙
  { bg: "#f0fdfa", fg: "#0f766e", solid: "#14b8a6" }, // 蓝绿
  { bg: "#fef2f2", fg: "#b91c1c", solid: "#dc2626" }, // 红
];
const TAG_FIXED: Record<string, { bg: string; fg: string; solid: string }> = {
  "全部": { bg: "var(--brand-50)", fg: "var(--brand-700)", solid: "var(--brand-800)" },
  "未分类": { bg: "#f1f5f9", fg: "#475569", solid: "#64748b" }, // 灰
  "经典": { bg: "#fefce8", fg: "#a16207", solid: "#ca8a04" },   // 黄
};
function tagColor(tag: string) {
  if (TAG_FIXED[tag]) return TAG_FIXED[tag];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

function inPeriod(dateStr: string, period: string): boolean {
  if (!dateStr || period === "全部") return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (period === "本周") {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    return d >= weekStart;
  }
  if (period === "本月") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === "今年") return d.getFullYear() === now.getFullYear();
  if (period === "更早") return d.getFullYear() < now.getFullYear();
  return true;
}

// ─── ConfirmDialog ────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="modal-overlay" onClick={onCancel} style={{ zIndex: 400 }}>
      <div style={{ background: "white", borderRadius: 14, padding: 24, width: 320, maxWidth: "90vw", boxShadow: "0 16px 48px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
            <AlertTriangle size={15} style={{ color: "#ef4444" }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--sb-ink)", marginBottom: 4 }}>确认删除</div>
            <div style={{ fontSize: 12, color: "var(--sb-text-muted)", lineHeight: 1.6 }}>{message}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} className="btn-ghost" style={{ fontSize: 12 }}>取消</button>
          <button onClick={onConfirm} style={{ background: "#ef4444", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

// ─── CreateModal ──────────────────────────────────────────
interface CreateModalProps {
  configDbs: string[];
  defaultDb: string;
  onClose: () => void;
  onCreate: (note: NoteItem) => void;
}

function CreateModal({ configDbs, defaultDb, onClose, onCreate }: CreateModalProps) {
  const [title, setTitle] = useState("");
  const [db, setDb] = useState(defaultDb !== "全部" ? defaultDb : (configDbs[0] || "闪念"));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true); setError("");
    try {
      const res = await apiClient.createNote({ title: title.trim(), database: db });
      onCreate(res.note);
      onClose();
    } catch {
      setError("创建失败，请检查网络或 Notion 配置");
    } finally { setCreating(false); }
  }

  const dbs = configDbs.filter(d => d !== "全部");

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 300 }}>
      <div style={{ background: "white", borderRadius: 14, width: 400, maxWidth: "95vw", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--sb-ink)" }}>新建知识</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--sb-text-muted)", display: "flex", alignItems: "center" }}><X size={16} /></button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: "var(--sb-text-muted)", display: "block", marginBottom: 6 }}>知识库</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {dbs.map(d => (
              <span key={d} onClick={() => setDb(d)}
                style={{ padding: "4px 12px", borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: db === d ? "var(--sb-ink)" : "var(--sb-muted)",
                  color: db === d ? "white" : "var(--sb-text-secondary)" }}>
                {d}
              </span>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, color: "var(--sb-text-muted)", display: "block", marginBottom: 6 }}>标题</label>
          <input ref={inputRef} type="text" value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
            placeholder="输入知识标题…"
            style={{ width: "100%", border: "1.5px solid var(--sb-border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>
        {error && <div style={{ fontSize: 11, color: "#dc2626", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn-ghost" style={{ fontSize: 12 }}>取消</button>
          <button onClick={handleCreate} className="btn-primary" disabled={!title.trim() || creating}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            {creating ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={12} />}
            {creating ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NoteModal ────────────────────────────────────────────
interface NoteModalProps {
  note: NoteItem;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: (updated: Partial<NoteItem>) => void;
}

function NoteModal({ note, onClose, onDeleted, onUpdated }: NoteModalProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || "");
  const [tags, setTags] = useState<string[]>(
    note.tags ? note.tags.split(",").map(t => t.trim()).filter(Boolean) : []
  );
  const [tagInput, setTagInput] = useState("");
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFlashNote = note.database === "闪念";

  useEffect(() => {
    apiClient.getNote(note.id).then(d => {
      setDetail(d);
      setTitle(d.title || note.title);
      setContent(d.content || note.content || "");
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); triggerSave(title, content); }
      if (e.key === "Escape") { if (confirmDelete) setConfirmDelete(false); else onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  function triggerSave(t: string, c: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await apiClient.updateNote(note.id, { title: t, content: c });
        onUpdated({ title: t, content: c });
        showToast("已同步到 Notion ✓");
      } catch { showToast("同步失败，请重试"); }
      finally { setSaving(false); }
    }, 800);
  }

  function saveTags(tgs: string[]) {
    if (tagsTimer.current) clearTimeout(tagsTimer.current);
    tagsTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await apiClient.updateNote(note.id, { tags: tgs.join(",") });
        onUpdated({ tags: tgs.join(",") });
        showToast("标签已同步到 Notion ✓");
      } catch { showToast("同步失败，请重试"); }
      finally { setSaving(false); }
    }, 500);
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (!tags.includes(t)) { const next = [...tags, t]; setTags(next); saveTags(next); }
    setTagInput("");
  }

  function removeTag(t: string) {
    const next = tags.filter(x => x !== t);
    setTags(next); saveTags(next);
  }

  async function doDelete() {
    setConfirmDelete(false);
    await apiClient.deleteNote(note.id);
    onDeleted(); onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="note-modal" onClick={e => e.stopPropagation()}>
        <div className="note-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand-50)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <FileText size={13} style={{ color: "var(--brand-500)" }} />
            </div>
            <input className="note-title-input" value={title}
              onChange={e => { setTitle(e.target.value); triggerSave(e.target.value, content); }}
              placeholder="标题" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {saving && <Loader2 size={12} style={{ animation: "spin 1s linear infinite", color: "var(--brand-500)" }} />}
            {toast && <span style={{ fontSize: 11, color: toast.includes("✓") ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{toast}</span>}
            {detail?.url && (
              <a href={detail.url} target="_blank" rel="noreferrer"
                style={{ fontSize: 10, color: "var(--brand-500)", textDecoration: "none", border: "1px solid var(--brand-200)", borderRadius: 6, padding: "3px 8px" }}>
                Notion
              </a>
            )}
            <button onClick={() => setConfirmDelete(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "#ef4444", display: "flex", alignItems: "center" }} title="删除">
              <Trash2 size={14} />
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--sb-text-muted)", display: "flex", alignItems: "center" }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* meta — always rendered, "—" until loaded */}
        <div style={{ padding: "8px 20px", fontSize: 10, color: "var(--sb-text-muted)", borderBottom: "1px solid var(--sb-border)", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Calendar size={10} />
            <span style={{ color: "var(--sb-text-secondary)" }}>创建</span>
            <span>{detail ? (fmtDate(detail.created) || "—") : "—"}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={10} />
            <span style={{ color: "var(--sb-text-secondary)" }}>修改</span>
            <span>{detail ? (fmtDate(detail.updated) || "—") : "—"}</span>
          </span>
        </div>

        {/* 闪念 tags */}
        {isFlashNote && (
          <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--sb-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Tag size={10} style={{ color: "var(--sb-text-muted)" }} />
              <span style={{ fontSize: 10, color: "var(--sb-text-muted)", fontWeight: 600 }}>标签</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
              {tags.map(t => (
                <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, padding: "2px 8px", borderRadius: 9999, background: "var(--brand-bg2)", color: "var(--brand-800)", fontWeight: 500 }}>
                  {t}
                  <button onClick={() => removeTag(t)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "var(--brand-800)", opacity: 0.6 }}>
                    <X size={9} />
                  </button>
                </span>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  onBlur={addTag}
                  placeholder="添加标签…"
                  style={{ fontSize: 10, border: "1px dashed var(--sb-border)", borderRadius: 9999, padding: "2px 8px", outline: "none", width: 80, background: "transparent", color: "var(--sb-text)" }}
                />
                {tagInput.trim() && (
                  <button onMouseDown={e => { e.preventDefault(); addTag(); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center", color: "var(--brand-500)" }}>
                    <Plus size={11} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="note-modal-body">
          <textarea className="note-content-textarea" value={content}
            onChange={e => { setContent(e.target.value); triggerSave(title, e.target.value); }}
            placeholder="开始编辑内容，失焦后自动同步到 Notion…" />
        </div>
        <div style={{ padding: "8px 20px", fontSize: 10, color: "var(--sb-text-muted)", borderTop: "1px solid var(--sb-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>编辑后自动保存 · Ctrl+S 立即同步</span>
          <span>{content.length} 字</span>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message="确认删除这条笔记？删除后可在 Notion 废纸篓中恢复。"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// ─── NoteCard ─────────────────────────────────────────────
interface NoteCardProps {
  note: NoteItem;
  showCategory: boolean;
  onClick: () => void;
  onDelete: () => void;
  onSend: () => void;
}

function NoteCard({ note, showCategory, onClick, onDelete, onSend }: NoteCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tags = note.tags ? note.tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="note-card" onClick={onClick}>
      <div className="note-card-menu-anchor" ref={menuRef}>
        <button className="note-card-dots" onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
          <MoreHorizontal size={13} />
        </button>
        {menuOpen && (
          <div className="note-card-dropdown">
            <button className="note-card-dd-item" onClick={e => { e.stopPropagation(); setMenuOpen(false); onSend(); }}>
              <MessageSquarePlus size={11} /> 发送到对话
            </button>
            <button className="note-card-dd-item danger" onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}>
              <Trash2 size={11} /> 删除
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <FileText size={11} style={{ color: "#3b82f6" }} />
        </div>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "var(--sb-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note.title}</div>
      </div>
      <div style={{ fontSize: 11, color: "var(--sb-text-muted)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{note.content}</div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8, gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {showCategory && note.database && (
            <span className="badge blue" style={{ fontSize: 9 }}>{note.database}</span>
          )}
          {!showCategory && note.database === "闪念" && tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {tags.slice(0, 3).map(t => {
                const c = tagColor(t);
                return <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 9999, background: c.bg, color: c.fg, fontWeight: 600 }}>{t}</span>;
              })}
            </div>
          )}
          {!showCategory && note.database !== "闪念" && note.status && (
            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 9999, background: "#f0fdf4", color: "#166534", fontWeight: 500 }}>{note.status}</span>
          )}
        </div>
        {(note.created || note.updated) && (
          <div style={{ fontSize: 9, color: "var(--sb-text-muted)", flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
            <Calendar size={8} />{fmtDate(note.created || note.updated)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SearchResultCard ─────────────────────────────────────
function SearchResultCard({ r }: { r: SearchResult }) {
  return (
    <div className="card" style={{ cursor: "default" }}>
      <div className="card-body">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--brand-50)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <FileText size={14} style={{ color: "var(--brand-500)" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sb-ink)" }}>{r.title || "无标题"}</div>
            <div style={{ fontSize: 10, color: "var(--sb-text-muted)", marginTop: 2 }}>{r.database || r.source || ""} · 相关文档</div>
            <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginTop: 6, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{r.content}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────
const STATUS_OPTS = ["全部", "未开始", "进行中", "完成"];
const TIME_OPTS = ["全部", "本周", "本月", "今年", "更早"];

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [configDbs, setConfigDbs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeFilter, setActiveFilter] = useState("全部");
  const [activeTag, setActiveTag] = useState("全部");
  const [activeStatus, setActiveStatus] = useState("全部");
  const [activeTime, setActiveTime] = useState("全部");
  const [timeOpen, setTimeOpen] = useState(false);
  const [modalNote, setModalNote] = useState<NoteItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtersLoaded = useRef(false);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Load saved filters after hydration (avoids SSR/client mismatch)
  useEffect(() => {
    const saved = loadFilters();
    setActiveFilter(saved.activeFilter);
    setActiveTag(saved.activeTag);
    setActiveStatus(saved.activeStatus);
    setActiveTime(saved.activeTime);
    filtersLoaded.current = true;
  }, []);

  // Persist filters to localStorage (only after initial load)
  useEffect(() => {
    if (!filtersLoaded.current) return;
    localStorage.setItem(FILTER_KEY, JSON.stringify({ activeFilter, activeStatus, activeTime, activeTag }));
  }, [activeFilter, activeStatus, activeTime, activeTag]);

  const loadAll = useCallback(async () => {
    try {
      const [n, s] = await Promise.all([apiClient.getNotes(), apiClient.getStatus()]);
      setNotes(n.notes || []);
      setConfigDbs((s as { databases?: string[] }).databases || []);
    } catch {}
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { loadAll(); }, []);

  async function doSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true); setSearched(true);
    try {
      const r = await apiClient.search(q, 20);
      setResults(r.results || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  async function doDelete(noteId: string) {
    setConfirmDeleteId(null);
    await apiClient.deleteNote(noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }

  function handleNoteUpdated(noteId: string, updated: Partial<NoteItem>) {
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, ...updated } : n));
  }

  function sendToChat(note: NoteItem) {
    const body = (note.content || "").slice(0, 400);
    const q = `我想结合这条笔记和你聊聊：\n\n《${note.title}》\n${body}`.trim();
    router.push(`/chat?q=${encodeURIComponent(q)}`);
  }

  const dbFilters = ["全部", ...configDbs];
  const showCategory = activeFilter === "全部";

  const flashTags = activeFilter === "闪念"
    ? ["全部", "未分类", ...Array.from(new Set(
        notes.filter(n => n.database === "闪念" && n.tags)
          .flatMap(n => n.tags.split(",").map(t => t.trim()).filter(Boolean))
      ))]
    : [];

  const filteredNotes = notes.filter(n => {
    if (activeFilter !== "全部" && n.database !== activeFilter) return false;
    if (activeFilter === "闪念" && activeTag !== "全部") {
      const noteTags = n.tags ? n.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
      if (activeTag === "未分类") { if (noteTags.length > 0) return false; }
      else { if (!noteTags.includes(activeTag)) return false; }
    }
    if (activeFilter === "目标") {
      if (activeStatus !== "全部" && n.status !== activeStatus) return false;
      if (activeTime !== "全部" && !inPeriod(n.created, activeTime)) return false;
    }
    return true;
  });

  function selectFilter(f: string) {
    setActiveFilter(f);
    setActiveTag("全部");
    setActiveStatus("全部");
    setActiveTime("全部");
    setTimeOpen(false);
    setSearched(false);
    setQuery("");
  }

  return (
    <div className="app-layout">
      <Sidebar activePage="search" />

      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <h1>知识搜索</h1>
            <div className="subtitle">共 {notes.length} 条笔记 · 实时从向量数据库读取</div>
          </div>
          <div className="topbar-right">
            <button className="btn-primary" onClick={() => setShowCreate(true)} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
              <Plus size={12} /> 新增知识
            </button>
          </div>
        </div>

        <div className="content">
          <div style={{ maxWidth: 640, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, background: "var(--sb-surface)", border: "1.5px solid var(--sb-border)", borderRadius: 12, padding: "4px" }}>
              <input ref={inputRef} type="text" placeholder="输入关键词搜索..."
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doSearch(query); }}
                style={{ flex: 1, border: "none", outline: "none", padding: "8px 12px", fontSize: 14, color: "var(--sb-text)", fontFamily: "inherit", background: "transparent" }} />
              <button className="btn-primary" onClick={() => doSearch(query)} disabled={loading || !query.trim()} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {loading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={13} />}
                {loading ? "搜索中..." : "搜索"}
              </button>
            </div>
          </div>

          {/* 数据库 Tab */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {dbFilters.map(tag => (
              <span key={tag} onClick={() => selectFilter(tag)}
                style={{ padding: "4px 12px", borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: activeFilter === tag ? "var(--sb-ink)" : "var(--sb-muted)",
                  color: activeFilter === tag ? "white" : "var(--sb-text-secondary)" }}>
                {tag}
                {tag !== "全部" && <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}>{notes.filter(n => n.database === tag).length}</span>}
              </span>
            ))}
          </div>

          {/* 闪念子标签 */}
          {activeFilter === "闪念" && flashTags.length > 2 && !searched && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Tag size={11} style={{ color: "var(--sb-text-muted)", flexShrink: 0 }} />
              {flashTags.map(tag => {
                const c = tagColor(tag);
                const on = activeTag === tag;
                return (
                  <span key={tag} onClick={() => setActiveTag(tag)}
                    style={{ padding: "3px 10px", borderRadius: 9999, fontSize: 10, fontWeight: 600, cursor: "pointer",
                      border: `1px solid ${on ? c.solid : "transparent"}`,
                      background: on ? c.solid : c.bg,
                      color: on ? "#fff" : c.fg }}>
                    {tag}
                  </span>
                );
              })}
            </div>
          )}

          {/* 目标状态 + 时间 */}
          {activeFilter === "目标" && !searched && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Filter size={11} style={{ color: "var(--sb-text-muted)", flexShrink: 0 }} />
              {STATUS_OPTS.map(s => (
                <span key={s} onClick={() => setActiveStatus(s)}
                  style={{ padding: "3px 10px", borderRadius: 9999, fontSize: 10, fontWeight: 500, cursor: "pointer",
                    background: activeStatus === s ? "var(--brand-700)" : "var(--brand-50)",
                    color: activeStatus === s ? "white" : "var(--brand-700)" }}>
                  {s}
                </span>
              ))}
              <span onClick={() => setTimeOpen(v => !v)}
                style={{ padding: "3px 10px", borderRadius: 9999, fontSize: 10, fontWeight: 500, cursor: "pointer",
                  background: activeTime !== "全部" ? "#0f766e" : "var(--sb-muted)",
                  color: activeTime !== "全部" ? "white" : "var(--sb-text-secondary)",
                  display: "flex", alignItems: "center", gap: 3 }}>
                <Calendar size={9} />
                {activeTime !== "全部" ? activeTime : "时间"}
                <ChevronDown size={9} style={{ transform: timeOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </span>
              {timeOpen && TIME_OPTS.map(t => (
                <span key={t} onClick={() => { setActiveTime(t); setTimeOpen(false); }}
                  style={{ padding: "3px 10px", borderRadius: 9999, fontSize: 10, fontWeight: 500, cursor: "pointer",
                    background: activeTime === t ? "#0f766e" : "#f0fdf4",
                    color: activeTime === t ? "white" : "#0f766e" }}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {loading && <div className="empty-state"><Loader2 size={14} style={{ animation: "spin 1s linear infinite", display: "inline" }} /> 搜索中...</div>}

          {!loading && searched && results.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <Search size={40} style={{ color: "var(--sb-border)", margin: "0 auto 12px", display: "block" }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sb-ink)", marginBottom: 8 }}>没有找到相关结果</div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)" }}>尝试用不同的关键词，或先同步 Notion 数据</div>
            </div>
          )}

          {!loading && searched && results.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginBottom: 12 }}>找到 {results.length} 条相关结果</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {results.map((r, i) => <SearchResultCard key={i} r={r} />)}
              </div>
            </div>
          )}

          {!searched && (
            <div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginBottom: 12 }}>
                {filteredNotes.length} 条笔记{activeFilter !== "全部" ? ` · ${activeFilter}` : ""}
                {activeFilter === "闪念" && activeTag !== "全部" ? ` · ${activeTag}` : ""}
                {activeFilter === "目标" && activeStatus !== "全部" ? ` · ${activeStatus}` : ""}
                {activeFilter === "目标" && activeTime !== "全部" ? ` · ${activeTime}` : ""}
              </div>
              {filteredNotes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <FileText size={40} style={{ color: "var(--sb-border)", margin: "0 auto 12px", display: "block" }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sb-ink)", marginBottom: 8 }}>暂无笔记</div>
                  <div style={{ fontSize: 12, color: "var(--sb-text-muted)" }}>先去同步 Notion 数据，或检查向量数据库状态</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {filteredNotes.map(note => (
                    <NoteCard key={note.id} note={note} showCategory={showCategory}
                      onClick={() => setModalNote(note)}
                      onDelete={() => setConfirmDeleteId(note.id)}
                      onSend={() => sendToChat(note)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <CreateModal configDbs={configDbs} defaultDb={activeFilter}
          onClose={() => setShowCreate(false)}
          onCreate={note => { setNotes(prev => [note, ...prev]); setModalNote(note); }}
        />
      )}

      {modalNote && (
        <NoteModal note={modalNote}
          onClose={() => setModalNote(null)}
          onDeleted={() => { setNotes(prev => prev.filter(n => n.id !== modalNote.id)); setModalNote(null); }}
          onUpdated={updated => handleNoteUpdated(modalNote.id, updated)}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          message="确认删除这条笔记？删除后可在 Notion 废纸篓中恢复。"
          onConfirm={() => doDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .note-card {
          position: relative; background: var(--sb-surface); border: 1px solid var(--sb-border);
          border-radius: 12px; padding: 14px; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .note-card:hover { border-color: var(--brand-300); box-shadow: 0 2px 8px color-mix(in srgb, var(--brand-500) 8%, transparent); }
        .note-card-menu-anchor { position: absolute; top: 8px; right: 8px; }
        .note-card-dots {
          opacity: 0; background: none; border: none; cursor: pointer;
          padding: 3px; border-radius: 6px; display: flex; align-items: center;
          color: var(--sb-text-muted); transition: opacity 0.15s, background 0.1s;
        }
        .note-card:hover .note-card-dots { opacity: 1; }
        .note-card-dots:hover { background: var(--sb-muted); }
        .note-card-dropdown {
          position: absolute; right: 0; top: 24px; z-index: 50;
          background: white; border: 1px solid var(--sb-border); border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 110px; overflow: hidden;
        }
        .note-card-dd-item {
          width: 100%; background: none; border: none; cursor: pointer;
          padding: 8px 12px; font-size: 12px; text-align: left; font-family: inherit;
          display: flex; align-items: center; gap: 6px; color: var(--sb-text-secondary);
        }
        .note-card-dd-item:hover { background: var(--sb-muted); }
        .note-card-dd-item.danger { color: #ef4444; }
        .note-card-dd-item.danger:hover { background: #fef2f2; }
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
        }
        .note-modal {
          background: white; border-radius: 16px; width: 680px; max-width: 95vw;
          max-height: 85vh; display: flex; flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden;
        }
        .note-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px; border-bottom: 1px solid var(--sb-border); gap: 8px;
        }
        .note-title-input {
          flex: 1; border: none; outline: none; font-size: 15px; font-weight: 700;
          color: var(--sb-ink); font-family: inherit; background: transparent;
        }
        .note-modal-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
        .note-content-textarea {
          width: 100%; height: 100%; min-height: 300px; border: none; outline: none;
          font-size: 13px; line-height: 1.8; color: var(--sb-text); font-family: inherit;
          resize: none; background: transparent;
        }
      `}</style>
    </div>
  );
}
