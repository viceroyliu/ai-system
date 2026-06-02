"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Check, Bot, Target, Plus,
  Clock, Circle, FileText, X,
  AlertTriangle, Play, RotateCcw, GripVertical,
} from "lucide-react";
import { apiClient, type Todo, type Review, type NoteItem } from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import Markdown from "@/components/Markdown";

// ─── types ───────────────────────────────────────────────────
type ScheduledGoal = { id: string; goalId: string; goalTitle: string; date: string; startDate?: string };
type PoolItem = { kind: "todo"; data: Todo } | { kind: "goal"; data: NoteItem };
type PoolStatus = "not_started" | "in_progress" | "done";
type FilterTab = "all" | "not_started" | "in_progress" | "done";
type AllItem = { kind: "done" | "review" | "goal"; text: string; id: string; goalId?: string; goalStatus?: "not_started" | "in_progress" | "done"; completionDate?: string; isGhost?: boolean };
type HoverCellState = { date: string; top: number; left: number; width: number; height: number };
type EditPaneMode =
  | { mode: "empty" }
  | { mode: "review"; item: Review }
  | { mode: "goal"; item: ScheduledGoal }
  | { mode: "new-review" };

// ─── helpers ─────────────────────────────────────────────────
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return iso(new Date()); }
function cn(...args: (string | boolean | undefined | null)[]) { return args.filter(Boolean).join(" "); }
function getMonthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Array<Date | null> = [];
  const dow = first.getDay();
  const mondayStart = dow === 0 ? 6 : dow - 1;
  for (let i = 0; i < mondayStart; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}
function newId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// 截断模型输出里的控制符（<turn|> 等）与退化乱码（连续单字母）
function cleanModelText(text: string) {
  let t = text || "";
  const ctrl = t.search(/<turn\|?>|<\|im_end\|>|<\|endoftext\|>|<end_of_turn>|<\|eot_id\|>|<\|im_start\|>/);
  if (ctrl >= 0) t = t.slice(0, ctrl);
  const degen = t.search(/(?:\b[a-zA-Z]\b[\s,，]+){12,}/);
  if (degen >= 0) t = t.slice(0, degen);
  return t.replace(/<\|[^>]*\|>/g, "").trim();
}

function getPoolStatus(item: PoolItem): PoolStatus {
  if (item.kind === "todo") {
    if (item.data.completedAt) return "done";
    return item.data.tag === "not_started" ? "not_started" : "in_progress";
  }
  const s = (item.data.status || "").trim();
  if (s === "进行中") return "in_progress";
  if (s === "完成" || s === "已完成") return "done";
  return "not_started";
}
function getPoolTitle(item: PoolItem): string { return item.data.title; }
function getPoolDoneDate(item: PoolItem): string | null {
  if (item.kind === "todo") return item.data.completedAt;
  return item.data.updated || null;
}

// ─── MarkdownText：统一走 react-markdown（含 GFM 表格/列表等）──
function MarkdownText({ text, style }: { text: string; style?: React.CSSProperties }) {
  if (!text) return null;
  return <div style={style}><Markdown>{text}</Markdown></div>;
}

// ─── ThinkingDots ─────────────────────────────────────────────
function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: "50%", display: "inline-block",
          background: "#94a3b8",
          animation: `think-dot 1.4s ease-in-out ${i * 0.25}s infinite`,
        }} />
      ))}
    </span>
  );
}

// ─── ConfirmDialog ────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = "确认" }: {
  message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 }}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, width: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
          <AlertTriangle size={18} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "#1e293b" }}>{message}</p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "7px 16px", border: "1px solid #e2e8f0", borderRadius: 8, background: "white", fontSize: 12, cursor: "pointer", color: "#64748b" }}>取消</button>
          <button onClick={onConfirm} style={{ padding: "7px 16px", border: "none", borderRadius: 8, background: "#ef4444", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── AddGoalModal ─────────────────────────────────────────────
function AddGoalModal({ onAdd, onClose }: { onAdd: (title: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Target size={14} /> 添加新目标</span>
          <button className="modal-close" onClick={onClose} style={{ display: "flex", alignItems: "center" }}><X size={14} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (title.trim()) { onAdd(title.trim()); onClose(); } }} className="modal-body">
          <input autoFocus className="modal-input" placeholder="目标标题，如：完成 React 深入学习"
            value={title} onChange={e => setTitle(e.target.value)} />
          <button type="submit" className="modal-submit" disabled={!title.trim()} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus size={13} /> 添加到目标池
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── CellEditModal ────────────────────────────────────────────
interface CellEditModalProps {
  date: Date;
  reviews: Review[];
  calendarGoals: ScheduledGoal[];
  todos: Todo[];
  goals: NoteItem[];
  initialPane?: EditPaneMode;
  onUpdateReview: (id: string, data: { date?: string; content?: string; title?: string }) => void;
  onDeleteReview: (id: string) => void;
  onMoveGoal: (id: string, newDate: string) => void;
  onRemoveGoal: (id: string) => void;
  onAddReview: (date: string, content: string, type: Review["type"], title?: string) => Promise<Review>;
  autoShowSummary?: boolean;
  onClose: () => void;
  recentContext?: string;
  yesterdayContext?: string;
}

function CellEditModal({
  date, reviews, calendarGoals, todos, goals, initialPane,
  onUpdateReview, onDeleteReview, onMoveGoal, onRemoveGoal, onAddReview, onClose,
  recentContext, yesterdayContext, autoShowSummary,
}: CellEditModalProps) {
  const [pane, setPane] = useState<EditPaneMode>(initialPane ?? { mode: "empty" });
  const [editContent, setEditContent] = useState("");
  const [editDate, setEditDateField] = useState("");
  const [newContent, setNewContent] = useState("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [aiThinking, setAiThinking] = useState("");
  const [aiThinkingLoading, setAiThinkingLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState<{ title: string; aiInsights: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (pane.mode === "review") {
      setEditContent(pane.item.content);
      setEditDateField(pane.item.date);
    } else if (pane.mode === "goal") {
      setEditDateField(pane.item.date);
    } else if (pane.mode === "new-review" && !aiThinking && !aiThinkingLoading) {
      setAiThinkingLoading(true);
      const prompt = yesterdayContext
        ? `今天是${dateStr}，准备写复盘并制定今日计划。\n\n昨日复盘总结：\n${yesterdayContext}\n\n根据昨日的复盘，给我2-3条今天最值得推进的具体行动建议，格式：\n- [行动]：[一句话理由]\n\n要求：口语化，聚焦可执行，不超过60字。`
        : recentContext
        ? `今天是${dateStr}，准备写复盘。\n\n近一个月背景：\n${recentContext}\n\n用第一性原理框架：\n1. 回顾目标 — 当初定了什么？\n2. 评估结果 — 和预期差在哪？\n3. 找根本原因 — 去掉表象，最核心的阻力是什么？\n\n给我一句话切入点（30字以内），口语化，直击当前最值得反思的本质问题，不要以"基于..."开头。`
        : `今天是${dateStr}，要写今天的复盘。\n\n用第一性原理框架问自己：今天做的事情里，哪一个假设是错的？\n\n给我一句话切入点（30字以内），口语化，直接。`;
      apiClient.chat(prompt, undefined, undefined, true)
        .then(r => setAiThinking(r.answer))
        .catch(() => {})
        .finally(() => setAiThinkingLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dateStr = date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  const visibleReviews = reviews.filter(r => !removedIds.has(r.id));
  const visibleGoals = calendarGoals.filter(g => !removedIds.has(g.id));
  const hasItems = visibleReviews.length > 0 || visibleGoals.length > 0;
  const isNewOnly = !hasItems && pane.mode === "new-review";

  function saveReview() {
    if (pane.mode !== "review") return;
    const updates: { date?: string; content?: string } = {};
    if (editContent !== pane.item.content) updates.content = editContent;
    if (editDate !== pane.item.date) updates.date = editDate;
    if (Object.keys(updates).length > 0) {
      onUpdateReview(pane.item.id, updates);
      if (updates.date) { onClose(); } else { setRemovedIds(prev => new Set([...prev, pane.item.id])); }
    }
  }
  function deleteReview() {
    if (pane.mode !== "review") return;
    onDeleteReview(pane.item.id);
    setRemovedIds(prev => new Set([...prev, pane.item.id]));
    setPane({ mode: "empty" });
  }
  function moveGoal() {
    if (pane.mode !== "goal" || editDate === pane.item.date) return;
    onMoveGoal(pane.item.id, editDate);
    setRemovedIds(prev => new Set([...prev, pane.item.id]));
    setPane({ mode: "empty" });
  }
  function removeGoal() {
    if (pane.mode !== "goal") return;
    onRemoveGoal(pane.item.id);
    setRemovedIds(prev => new Set([...prev, pane.item.id]));
    setPane({ mode: "empty" });
  }
  async function submitNewReview() {
    if (!newContent.trim() || submitting) return;
    const content = newContent.trim();
    setSubmitting(true);
    setNewContent("");
    try {
      let title = "";
      try {
        const r = await apiClient.chat(
          `给下面这段复盘内容起一个10字以内的标题，只输出标题本身，不要加引号或解释：\n\n${content.slice(0, 200)}`,
          undefined, undefined, true
        );
        title = r.answer.trim().replace(/^["「『]|["」』]$/g, "").slice(0, 15);
      } catch {}
      const review = await onAddReview(iso(date), content, "daily", title || undefined);
      if (autoShowSummary && review.aiInsights) {
        setSummaryResult({ title: review.title || title || "复盘", aiInsights: review.aiInsights });
      } else {
        if (isNewOnly) { onClose(); }
        else { setPane({ mode: "empty" }); }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resolveGoalStatusForPane(goalId: string): "not_started" | "in_progress" | "done" {
    const td = todos.find(t => t.id === goalId);
    if (td) return td.completedAt ? "done" : td.tag === "not_started" ? "not_started" : "in_progress";
    const gl = goals.find(g => g.id === goalId);
    if (gl) { const s = (gl.status || "").trim(); if (s === "进行中") return "in_progress"; if (s === "完成" || s === "已完成") return "done"; }
    return "not_started";
  }

  function goalChipColor(goalId: string) {
    const s = resolveGoalStatusForPane(goalId);
    if (s === "done") return { bg: "#dcfce7", border: "#86efac", color: "#15803d" };
    if (s === "in_progress") return { bg: "var(--brand-50)", border: "var(--brand-300)", color: "var(--brand-500)" };
    return { bg: "#f1f5f9", border: "#cbd5e1", color: "#475569" };
  }

  const leftItemStyle = (sel: boolean, color: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
    cursor: "pointer", fontSize: 12,
    background: sel ? `${color}18` : "transparent",
    borderLeft: sel ? `2px solid ${color}` : "2px solid transparent",
    transition: "background 0.1s",
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "white", borderRadius: 16,
        width: isNewOnly ? 520 : 720, maxWidth: "95vw",
        height: isNewOnly ? "auto" : 480, maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.22)", overflow: "hidden",
      }}>
        {(() => {
          const paneColor = pane.mode === "review" ? "#0f766e"
            : pane.mode === "goal" ? (() => {
                const sg = calendarGoals.find(g => g.id === pane.item.id);
                if (!sg) return "#475569";
                const s = resolveGoalStatusForPane(sg.goalId);
                return s === "done" ? "#15803d" : s === "in_progress" ? "var(--brand-500)" : "#475569";
              })()
            : "var(--sb-text)";
          return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: `2px solid ${paneColor === "var(--sb-text)" ? "var(--sb-border)" : paneColor + "40"}`, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: paneColor }}>{isNewOnly ? `${dateStr} · 新建复盘` : `${dateStr} · 复盘与目标`}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {hasItems && pane.mode !== "new-review" && (
              <button onClick={() => setPane({ mode: "new-review" })}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--sb-primary)", color: "white", border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                <Plus size={11} /> 添加复盘
              </button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--sb-text-muted)", display: "flex", alignItems: "center" }}><X size={16} /></button>
          </div>
        </div>
          );
        })()}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {hasItems && (
            <div style={{ width: 220, borderRight: "1px solid var(--sb-border)", overflowY: "auto", padding: "10px 0", flexShrink: 0 }}>
              {visibleReviews.length > 0 && (
                <>
                  <div style={{ padding: "4px 16px 4px", fontSize: 9, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>复盘</div>
                  {visibleReviews.map(r => {
                    const sel = pane.mode === "review" && pane.item.id === r.id;
                    const displayTitle = r.title || r.content.slice(0, 14);
                    return (
                      <div key={r.id} onClick={() => setPane({ mode: "review", item: r })} style={leftItemStyle(sel, "#0f766e")}
                        onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = "var(--sb-muted)"; }}
                        onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                        <FileText size={11} style={{ flexShrink: 0, color: "#0f766e" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{displayTitle}</span>
                      </div>
                    );
                  })}
                </>
              )}
              {visibleGoals.length > 0 && (
                <>
                  <div style={{ padding: "8px 16px 4px", fontSize: 9, fontWeight: 700, color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>目标</div>
                  {visibleGoals.map(g => {
                    const sel = pane.mode === "goal" && pane.item.id === g.id;
                    const gc = goalChipColor(g.goalId);
                    return (
                      <div key={g.id} onClick={() => setPane({ mode: "goal", item: g })} style={leftItemStyle(sel, gc.color)}
                        onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = "var(--sb-muted)"; }}
                        onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                        <Target size={11} style={{ flexShrink: 0, color: gc.color }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{g.goalTitle.slice(0, 16)}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            {!summaryResult && pane.mode === "empty" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--sb-text-muted)", fontSize: 12 }}>
                <FileText size={32} style={{ opacity: 0.15, marginBottom: 10 }} />
                选择左侧项目开始编辑
              </div>
            )}
            {!summaryResult && pane.mode === "new-review" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(aiThinkingLoading || aiThinking) && (
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <Bot size={13} style={{ color: "#94a3b8", flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      {aiThinkingLoading
                        ? <ThinkingDots />
                        : <MarkdownText text={aiThinking} style={{ fontSize: 12, color: "#374151" }} />
                      }
                    </div>
                  </div>
                )}
                <textarea autoFocus className="modal-textarea" placeholder="写一下今天的复盘..."
                  value={newContent} onChange={e => setNewContent(e.target.value)}
                  rows={6} style={{ width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={submitNewReview} disabled={!newContent.trim() || submitting} className="modal-submit" style={{ flex: 1, opacity: submitting ? 0.7 : 1 }}>{submitting ? "保存中..." : "保存复盘"}</button>
                  {hasItems && (
                    <button onClick={() => setPane({ mode: "empty" })}
                      style={{ padding: "9px 16px", border: "1px solid var(--sb-border)", borderRadius: 8, background: "white", fontSize: 12, cursor: "pointer", color: "var(--sb-text-muted)" }}>
                      取消
                    </button>
                  )}
                </div>
              </div>
            )}
            {summaryResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f766e", display: "flex", alignItems: "center", gap: 6 }}>
                  <Bot size={13} /> {summaryResult.title} · AI 总结
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "14px 16px" }}>
                  <MarkdownText text={summaryResult.aiInsights} style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.75 }} />
                </div>
                <button
                  onClick={() => { setSummaryResult(null); if (isNewOnly) { onClose(); } else { setPane({ mode: "empty" }); } }}
                  className="modal-submit"
                  style={{ alignSelf: "flex-end", padding: "9px 24px" }}>
                  好的
                </button>
              </div>
            )}
            {!summaryResult && pane.mode === "review" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f766e", display: "flex", alignItems: "center", gap: 6 }}>
                  <FileText size={13} /> {pane.item.title || (pane.item.type === "weekly" ? "周复盘" : pane.item.type === "monthly" ? "月复盘" : "复盘")}
                </div>
                <div className="modal-row">
                  <label className="modal-label">日期</label>
                  <input type="date" className="modal-input" value={editDate} onChange={e => setEditDateField(e.target.value)} />
                </div>
                <div className="modal-row">
                  <label className="modal-label">内容</label>
                  <textarea className="modal-textarea" rows={5} value={editContent} onChange={e => setEditContent(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                </div>
                {pane.item.aiInsights && (
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                      <Bot size={11} style={{ color: "#16a34a" }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.05em" }}>AI 总结</span>
                    </div>
                    <MarkdownText text={pane.item.aiInsights} style={{ fontSize: 12, color: "#374151", lineHeight: 1.7 }} />
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveReview} className="modal-submit" style={{ flex: 1 }}>保存修改</button>
                  <button onClick={deleteReview} style={{ padding: "9px 14px", border: "1px solid #fca5a5", borderRadius: 8, background: "#fff5f5", fontSize: 12, color: "#ef4444", cursor: "pointer", fontWeight: 600 }}>删除</button>
                </div>
              </div>
            )}
            {!summaryResult && pane.mode === "goal" && (() => {
              const gc = goalChipColor(pane.item.goalId);
              const goalStatus = resolveGoalStatusForPane(pane.item.goalId);
              const isDoneGoal = goalStatus === "done";
              const completionDate = isDoneGoal ? (() => {
                const td = todos.find(t => t.id === pane.item.goalId);
                if (td?.completedAt) return td.completedAt.slice(0, 10);
                const gl = goals.find(g => g.id === pane.item.goalId);
                if (gl?.updated) return gl.updated.slice(0, 10);
                return pane.item.date;
              })() : null;
              return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: gc.color, display: "flex", alignItems: "center", gap: 6 }}>
                  <Target size={13} /> 目标
                </div>
                <div style={{ background: gc.bg, border: `1px solid ${gc.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: gc.color, display: "flex", alignItems: "center", gap: 6 }}>
                  <Target size={12} /> {pane.item.goalTitle}
                </div>
                {isDoneGoal ? (
                  <>
                    <div className="modal-row">
                      <label className="modal-label">开始日期</label>
                      <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: 8, fontSize: 13, color: "var(--sb-text)" }}>{pane.item.startDate || pane.item.date}</div>
                    </div>
                    <div className="modal-row">
                      <label className="modal-label">完成日期</label>
                      <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: 8, fontSize: 13, color: "var(--sb-text)" }}>{completionDate}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={removeGoal} style={{ padding: "9px 14px", border: "1px solid #fca5a5", borderRadius: 8, background: "#fff5f5", fontSize: 12, color: "#ef4444", cursor: "pointer", fontWeight: 600, flex: 1 }}>移出日历</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="modal-row">
                      <label className="modal-label">计划日期</label>
                      <input type="date" className="modal-input" value={editDate} onChange={e => setEditDateField(e.target.value)} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={moveGoal} disabled={editDate === pane.item.date} className="modal-submit" style={{ flex: 1, opacity: editDate === pane.item.date ? 0.5 : 1 }}>移动到新日期</button>
                      <button onClick={removeGoal} style={{ padding: "9px 14px", border: "1px solid #fca5a5", borderRadius: 8, background: "#fff5f5", fontSize: 12, color: "#ef4444", cursor: "pointer", fontWeight: 600 }}>移出日历</button>
                    </div>
                  </>
                )}
              </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CellHoverCard ────────────────────────────────────────────
interface CellHoverCardProps {
  date: Date;
  allItems: AllItem[];
  reviews: Review[];
  calGoals: ScheduledGoal[];
  position: HoverCellState;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  onSelectItem: (pane: EditPaneMode) => void;
  onHoverEnter: () => void;
  onClose: () => void;
  onMoveGoal: (id: string, newDate: string) => void;
  onGoalHover: (range: { startDate: string; endDate?: string; color: string; status: "in_progress" | "done"; itemIndex: number; dashed?: boolean } | null) => void;
}

function CellHoverCard({ date, allItems, reviews, calGoals, position, popoverRef, onSelectItem, onHoverEnter, onClose, onMoveGoal, onGoalHover }: CellHoverCardProps) {
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const minH = Math.max(position.height, allItems.length * 28 + 44);
  // Anchor at cell top; flip up if overflows viewport
  let top = position.top;
  if (top + minH > vh - 16) top = Math.max(8, vh - minH - 16);

  function goalColor(gs?: "not_started" | "in_progress" | "done") {
    if (gs === "done") return { bg: "#dcfce7", color: "#15803d" };
    if (gs === "in_progress") return { bg: "var(--brand-50)", color: "var(--brand-500)" };
    return { bg: "#f1f5f9", color: "#475569" };
  }
  function itemColor(item: AllItem) {
    if (item.kind === "done") return { bg: "#dcfce7", color: "#15803d" };
    if (item.kind === "review") return { bg: "#ccfbf1", color: "#0f766e" };
    return goalColor(item.goalStatus);
  }

  function getPane(item: AllItem): EditPaneMode {
    if (item.kind === "review") { const r = reviews.find(r => r.id === item.id); return r ? { mode: "review", item: r } : { mode: "empty" }; }
    if (item.kind === "goal") { const g = calGoals.find(g => g.id === item.id); return g ? { mode: "goal", item: g } : { mode: "empty" }; }
    return { mode: "empty" };
  }

  const dateStr = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });

  return (
    <div
      ref={popoverRef as React.RefObject<HTMLDivElement>}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onClose}
      style={{
        position: "fixed", top, left: position.left,
        width: position.width, minHeight: position.height,
        zIndex: 150,
        background: "white", borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        border: "1.5px solid var(--brand-200)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "5px 8px", fontSize: 10, fontWeight: 700, color: "var(--sb-text-muted)", background: "#f8faff", borderBottom: "1px solid var(--sb-border)", display: "flex", justifyContent: "space-between" }}>
        <span>{dateStr}</span>
        <span style={{ opacity: 0.4 }}>{allItems.length} 项</span>
      </div>
      {allItems.map(item => {
        const clickable = item.kind !== "done" && !item.isGhost;
        const draggable = item.kind === "goal" && !item.isGhost;
        const c = itemColor(item);
        return (
          <div key={item.id}
            draggable={draggable}
            onDragStart={draggable ? e => {
              e.dataTransfer.setData("goalId", item.goalId!);
              e.dataTransfer.setData("goalTitle", item.text);
              e.dataTransfer.setData("fromGoalScheduleId", item.id);
            } : undefined}
            onClick={e => { e.stopPropagation(); if (clickable) onSelectItem(getPane(item)); }}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", cursor: draggable ? "grab" : clickable ? "pointer" : "default" }}
            onMouseEnter={e => {
              if (clickable || draggable) (e.currentTarget as HTMLElement).style.background = "var(--sb-muted)";
              if (item.kind === "goal") {
                const itemIndex = allItems.findIndex(i => i.id === item.id);
                if (item.isGhost) {
                  // Ghost chip: dashed line from this cell back to done chip's date
                  if (item.completionDate) {
                    onGoalHover({ startDate: iso(date), endDate: item.completionDate, color: "var(--brand-500)", status: "done", itemIndex, dashed: true });
                  }
                } else if (item.goalStatus === "done") {
                  // Done chip: dashed line back to in_progress position (startDate)
                  const sg = calGoals.find(g => g.id === item.id);
                  if (sg?.startDate && sg.startDate !== sg.date) {
                    onGoalHover({ startDate: sg.startDate, endDate: sg.date, color: "var(--brand-500)", status: "done", itemIndex, dashed: true });
                  }
                }
                // in_progress goals: no connecting line
              }
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              if (item.kind === "goal" && (item.goalStatus === "done" || item.isGhost)) onGoalHover(null);
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 3, flexShrink: 0, background: c.bg, color: c.color }}>
              {item.kind === "done" ? <Check size={9} /> : item.kind === "review" ? <FileText size={9} /> : <Target size={9} />}
            </span>
            <span style={{ fontSize: 11, color: "var(--sb-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{item.text}</span>
            {draggable && <GripVertical size={10} style={{ color: "#cbd5e1", flexShrink: 0 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── ProgressCarousel ─────────────────────────────────────────
type CarouselPeriod = "today" | "week" | "month" | "streak";
const PERIODS: CarouselPeriod[] = ["today", "week", "month", "streak"];

function ProgressCarousel({ todos }: { todos: Todo[] }) {
  const [period, setPeriod] = useState<CarouselPeriod>("today");
  const now = new Date();
  const doneBetween = (start: Date, end: Date) =>
    todos.filter(t => t.completedAt && new Date(t.completedAt) >= start && new Date(t.completedAt) <= end).length;
  const todayDone = doneBetween(new Date(now.getFullYear(), now.getMonth(), now.getDate()), now);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekDone = doneBetween(weekStart, now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDone = doneBetween(monthStart, now);
  let streak = 0;
  { const d = new Date(now); d.setHours(23, 59, 59, 999); while (true) { const ds = iso(d); if (!todos.some(t => t.completedAt && t.completedAt.slice(0, 10) === ds)) break; streak++; d.setDate(d.getDate() - 1); d.setHours(23, 59, 59, 999); } }
  const stats: Record<CarouselPeriod, { label: string; value: number; color: string }> = {
    today: { label: "今日完成", value: todayDone, color: "var(--brand-500)" },
    week: { label: "本周完成", value: weekDone, color: "#10b981" },
    month: { label: "本月完成", value: monthDone, color: "#f59e0b" },
    streak: { label: "连续活跃", value: streak, color: "var(--sb-accent)" },
  };
  const cur = stats[period];
  function advance() { const idx = PERIODS.indexOf(period); setPeriod(PERIODS[(idx + 1) % PERIODS.length]); }
  return (
    <div className="progress-carousel" onClick={advance} style={{ cursor: "pointer" }}>
      <div className="carousel-dots" onClick={e => e.stopPropagation()}>
        {PERIODS.map(p => (<button key={p} className={cn("carousel-dot", period === p && "active")} onClick={e => { e.stopPropagation(); setPeriod(p); }} />))}
      </div>
      <div className="carousel-content">
        <span className="carousel-label">{cur.label}</span>
        <span className="carousel-value" style={{ color: cur.color }}>{cur.value}</span>
        <span className="carousel-unit">项</span>
      </div>
    </div>
  );
}

// ─── main ─────────────────────────────────────────────────────
type ViewMode = "month" | "week" | "year";

export default function CalendarPage() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [goals, setGoals] = useState<NoteItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [calendarGoals, setCalendarGoals] = useState<ScheduledGoal[]>([]);
  const [calendarGoalsReady, setCalendarGoalsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [monthNote, setMonthNote] = useState("");
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [editDate, setEditDate] = useState<Date | null>(null);
  const [editInitialPane, setEditInitialPane] = useState<EditPaneMode | undefined>(undefined);
  const [hoverCell, setHoverCell] = useState<HoverCellState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("not_started");
  const [view, setView] = useState<ViewMode>("month");
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(true);
  const [hoveredGoalRange, setHoveredGoalRange] = useState<{ startDate: string; endDate?: string; color: string; status: "in_progress" | "done"; itemIndex: number; dashed?: boolean } | null>(null);
  const [autoShowSummary, setAutoShowSummary] = useState(true);
  const [editingPoolItemId, setEditingPoolItemId] = useState<string | null>(null);
  const [editingPoolTitle, setEditingPoolTitle] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoverLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monthSwitchRef = useRef<number>(0);

  // Load from localStorage after hydration (avoids SSR/client mismatch)
  useEffect(() => {
    try {
      const s = localStorage.getItem("ai_calendar_goals");
      if (s) setCalendarGoals(JSON.parse(s));
    } catch {}
    setCalendarGoalsReady(true);
  }, []);
  // Save only after initial load to avoid overwriting stored data with empty []
  useEffect(() => {
    if (!calendarGoalsReady) return;
    localStorage.setItem("ai_calendar_goals", JSON.stringify(calendarGoals));
  }, [calendarGoals, calendarGoalsReady]);

  const monthDays = getMonthDays(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
  const viewMonthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;

  // AI 总结：按当前视图（周/月/年）把对应范围的复盘/完成项/安排的目标汇总后发给 AI 对话；无记录则提示
  function rangeSummary() {
    const ymd = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    let inRange: (d?: string | null) => boolean;
    let label: string;
    let scope: string;       // 周度 / 月度 / 年度
    let emptyNote: string;
    let rangeWord: string;   // 提示词里的范围措辞
    if (view === "year") {
      const p = `${viewYear}-`;
      inRange = (d) => (d || "").startsWith(p);
      label = `${viewYear} 年`;
      scope = "年度"; emptyNote = "本年无记录"; rangeWord = "今年";
    } else if (view === "week") {
      const now = new Date();
      const ws = new Date(now);
      ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7)); // 周一
      ws.setHours(0, 0, 0, 0);
      const we = new Date(ws); we.setDate(ws.getDate() + 6); we.setHours(23, 59, 59, 999);
      const s = ymd(ws), e = ymd(we);
      inRange = (d) => { const x = (d || "").slice(0, 10); return !!x && x >= s && x <= e; };
      label = `${s} ~ ${e}（本周）`;
      scope = "周度"; emptyNote = "本周无记录"; rangeWord = "这一周";
    } else {
      const p = viewMonthPrefix;
      inRange = (d) => (d || "").startsWith(p);
      label = `${viewYear} 年 ${viewMonth + 1} 月`;
      scope = "月度"; emptyNote = "当月无记录"; rangeWord = "这个月";
    }

    const rangeRevs = reviews.filter(r => inRange(r.date));
    const doneTodos = todos.filter(t => inRange(t.completedAt));
    const rangeGoals = calendarGoals.filter(g => inRange(g.date));
    if (rangeRevs.length === 0 && doneTodos.length === 0 && rangeGoals.length === 0) {
      setMonthNote(emptyNote);
      setTimeout(() => setMonthNote(""), 2600);
      return;
    }
    const parts: string[] = [`这是我「${label}」的复盘日历数据，请基于它帮我做一次${scope}总结：提炼${rangeWord}的主线与进展、指出最值得反思的一点，并给出下一阶段可执行的建议。`];
    if (rangeRevs.length) parts.push(`【复盘 ${rangeRevs.length} 条】\n` + rangeRevs.map(r => `(${r.date}) ${(r.title || "").trim()} ${(r.content || "").slice(0, 240)}`.trim()).join("\n"));
    if (doneTodos.length) parts.push(`【完成 ${doneTodos.length} 项】\n` + doneTodos.map(t => `- ${t.title}`).join("\n"));
    if (rangeGoals.length) parts.push(`【安排的目标 ${rangeGoals.length} 个】\n` + rangeGoals.map(g => `- ${g.goalTitle}（${g.date}）`).join("\n"));
    const prompt = parts.join("\n\n");
    try { sessionStorage.setItem("ai_chat_autosend", prompt); } catch {}
    router.push("/chat?auto=1");
  }

  const load = useCallback(async () => {
    try {
      const [t, r, notes, sett] = await Promise.all([apiClient.getTodos(), apiClient.getReviews(), apiClient.getNotes(), apiClient.getSettings().catch(() => null)]);
      if (sett) setAutoShowSummary(sett.review?.auto_show_summary !== false);
      setTodos(t.todos);
      setReviews(r.reviews);
      const goalsData = notes.notes.filter(n => n.database === "目标");
      setGoals(goalsData);

      // Build AI suggestion with fresh data
      const poolItems: PoolItem[] = [
        ...t.todos.map(td => ({ kind: "todo" as const, data: td })),
        ...goalsData.map(g => ({ kind: "goal" as const, data: g })),
      ];
      const notStarted = poolItems.filter(i => getPoolStatus(i) === "not_started").length;
      const inProg = poolItems.filter(i => getPoolStatus(i) === "in_progress").length;
      const curMonthPfx = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; })();
      const doneC = poolItems.filter(i => {
        if (getPoolStatus(i) !== "done") return false;
        const d = getPoolDoneDate(i);
        return !!d && d.startsWith(curMonthPfx);
      }).length;
      const allRevsSorted = r.reviews
        .map(rv => ({ date: rv.date, text: rv.title || rv.content }))
        .sort((a, b) => b.date.localeCompare(a.date));
      // 近一个月复盘优先，最多取 5 条；若不足则补全历史
      const recentRevs = allRevsSorted.filter(rv => rv.date >= curMonthPfx);
      const olderRevs = allRevsSorted.filter(rv => rv.date < curMonthPfx);
      const topRevs = [...recentRevs, ...olderRevs].slice(0, 5);
      const revContext = topRevs.length > 0
        ? topRevs.map(rv => `(${rv.date}) ${rv.text.slice(0, 80)}`).join("\n")
        : "暂无复盘记录";
      // 所有目标：未完成全列，完成的只取本月
      const allGoalsContext = poolItems
        .filter(i => getPoolStatus(i) === "not_started" || getPoolStatus(i) === "in_progress")
        .map(i => i.data.title)
        .slice(0, 8).join("、") || "暂无进行中目标";
      // AI 分析每天只生成一次：命中当天缓存则直接复用，避免每次进页面都重新生成
      const today = todayStr();
      const CACHE_KEY = "ai_calendar_analysis_v2"; // v2：清掉早期含控制符乱码的缓存
      let cached: { date?: string; text?: string } | null = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch {}
      if (cached && cached.date === today && cached.text) {
        setAiSuggestion(cleanModelText(cached.text));
        setAiSuggestionLoading(false);
      } else {
        const aiPrompt = `你是一位运用第一性原理思考的AI顾问（参考埃隆·马斯克和查理·芒格的思维框架）。\n\n第一步：拆解基本事实\n用户当前状态：\n- 目标：未开始 ${notStarted} 个，进行中 ${inProg} 个，本月已完成 ${doneC} 个\n- 进行中的目标：${allGoalsContext}\n\n第二步：审视近期复盘（近一个月优先）\n${revContext}\n\n第三步：从第一性原理出发\n忽略表面现象，直击本质：当前最核心的阻力或机遇是什么？\n\n请输出：一条 100-150 字的精准行动建议，有洞察力，结合以上数据，给出可执行方向，不要说套话。`;
        apiClient.chat(aiPrompt, undefined, undefined, true)
          .then(resp => {
            const clean = cleanModelText(resp.answer);
            setAiSuggestion(clean); setAiSuggestionLoading(false);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, text: clean })); } catch {}
          })
          .catch(() => { setAiSuggestion(""); setAiSuggestionLoading(false); });
      }
    } catch (e) { console.error(e); setAiSuggestionLoading(false); }
    finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") { e.preventDefault(); setShowAddGoal(true); }
      if (e.key === "Escape") { setHoverCell(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── yesterday context: use aiInsights from the previous day's reviews
  const yesterdayContext = (() => {
    if (!editDate) return "";
    const prev = iso(new Date(editDate.getTime() - 86400000));
    const prevRevs = reviews.filter(r => r.date === prev && (r.aiInsights || r.content));
    if (prevRevs.length === 0) return "";
    return prevRevs.map(r => r.aiInsights || r.content.slice(0, 300)).join("\n\n");
  })();

  // ── recent context for AI new-review prompt ───────────────
  const recentContext = (() => {
    if (!editDate) return "";
    const ds = iso(editDate);
    // 近一个月（以点击日期为终点，往前 30 天）
    const monthAgo = iso(new Date(editDate.getTime() - 30 * 86400000));
    const nearbyRevs = reviews
      .map(r => ({ date: r.date, text: r.title || r.content }))
      .filter(r => r.date >= monthAgo && r.date <= ds)
     .sort((a, b) => b.date.localeCompare(a.date))
     .slice(0, 5);
    const cellGoals = calendarGoals.filter(g => g.date === ds);
    // 进行中/未完成目标
    const activeGoals: PoolItem[] = [
      ...todos.map(t => ({ kind: "todo" as const, data: t })),
      ...goals.map(g => ({ kind: "goal" as const, data: g })),
    ].filter(i => getPoolStatus(i) === "in_progress" || getPoolStatus(i) === "not_started").slice(0, 5);
    const parts: string[] = [];
    if (nearbyRevs.length > 0)
      parts.push(`近一个月复盘：\n${nearbyRevs.map(r => `[${r.date}] ${r.text.slice(0, 60)}`).join("\n")}`);
    if (cellGoals.length > 0)
      parts.push(`当天安排目标：${cellGoals.map(g => g.goalTitle).join("、")}`);
    if (activeGoals.length > 0)
      parts.push(`当前进行中/未开始目标：${activeGoals.map(i => i.kind === "todo" ? (i.data as import("@/lib/api").Todo).title : (i.data as import("@/lib/api").NoteItem).title).join("、")}`);
    return parts.join("\n\n");
  })();

  // ── pool item derived state ────────────────────────────────
  const allPoolItems: PoolItem[] = [
    ...todos.map(t => ({ kind: "todo" as const, data: t })),
    ...goals.map(g => ({ kind: "goal" as const, data: g })),
  ];
  function isInViewMonth(item: PoolItem): boolean { const d = getPoolDoneDate(item); return !!d && d.startsWith(viewMonthPrefix); }
  const notStartedItems = allPoolItems.filter(i => getPoolStatus(i) === "not_started");
  const inProgressItems = allPoolItems.filter(i => getPoolStatus(i) === "in_progress");
  const doneItems = allPoolItems.filter(i => getPoolStatus(i) === "done" && isInViewMonth(i));
  const countAll = notStartedItems.length + inProgressItems.length + doneItems.length;
  function showSection(s: PoolStatus): boolean { if (filter === "all") return true; return filter === s; }

  // ── open cell ─────────────────────────────────────────────
  function openCell(day: Date, initialPane?: EditPaneMode) {
    setEditDate(day);
    setEditInitialPane(initialPane);
    setHoverCell(null);
    if (hoverLeaveRef.current) clearTimeout(hoverLeaveRef.current);
  }

  // ── month edge switching during drag ──────────────────────
  function switchMonthEdge(dir: "prev" | "next") {
    const now = Date.now();
    if (now - monthSwitchRef.current < 1500) return;
    monthSwitchRef.current = now;
    if (dir === "prev") prevMonth();
    else nextMonth();
  }

  // ── handlers ──────────────────────────────────────────────
  async function handleAddGoal(title: string) {
    const tempId = "temp-" + newId();
    const tempGoal: NoteItem = { id: tempId, title, content: "", database: "目标", updated: "", created: new Date().toISOString(), tags: "", status: "" };
    setGoals(prev => [tempGoal, ...prev]);
    try {
      const { note } = await apiClient.createNote({ title, database: "目标" });
      setGoals(prev => prev.map(g => g.id === tempId ? note : g));
      setCalendarGoals(prev => prev.map(g => g.goalId === tempId ? { ...g, goalId: note.id } : g));
    } catch (e) {
      console.error(e);
      setGoals(prev => prev.filter(g => g.id !== tempId));
    }
  }

  async function handleAdvance(item: PoolItem) {
    try {
      const status = getPoolStatus(item);
      const today = todayStr();
      const title = getPoolTitle(item);
      const id = item.data.id;
      if (item.kind === "todo") {
        if (status === "not_started") {
          setTodos(prev => prev.map(t => t.id === id ? { ...t, tag: "in_progress" } : t));
          handleDropGoal(id, title, today, today);
          await apiClient.patchTodo(id, { tag: "in_progress" });
        } else if (status === "in_progress") {
          setTodos(prev => prev.map(t => t.id === id ? { ...t, completedAt: new Date().toISOString() } : t));
          await apiClient.patchTodo(id, { completed: true });
        } else {
          setTodos(prev => prev.map(t => t.id === id ? { ...t, completedAt: null } : t));
          setCalendarGoals(prev => prev.filter(g => g.goalId !== id));
          await apiClient.patchTodo(id, { completed: false });
        }
      } else {
        if (status === "not_started") {
          setGoals(prev => prev.map(g => g.id === id ? { ...g, status: "进行中" } : g));
          handleDropGoal(id, title, today, today);
          await apiClient.updateNote(id, { status: "进行中" });
        } else if (status === "in_progress") {
          const completionTime = new Date().toISOString();
          setGoals(prev => prev.map(g => g.id === id ? { ...g, status: "完成", updated: completionTime } : g));
          setCalendarGoals(prev => prev.map(g => g.goalId === id ? { ...g, date: today } : g));
          await apiClient.updateNote(id, { status: "完成" });
        } else {
          setGoals(prev => prev.map(g => g.id === id ? { ...g, status: "进行中" } : g));
          setCalendarGoals(prev => prev.filter(g => g.goalId !== id));
          await apiClient.updateNote(id, { status: "进行中" });
        }
      }
    } catch (e) { console.error(e); }
  }

  function handleDeleteItem(item: PoolItem) {
    setConfirmState({
      message: "确认删除这个目标？",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          if (item.kind === "todo") { await apiClient.deleteTodo(item.data.id); setTodos(prev => prev.filter(t => t.id !== item.data.id)); }
          else { await apiClient.deleteNote(item.data.id); setGoals(prev => prev.filter(g => g.id !== item.data.id)); }
        } catch (e) { console.error(e); }
      },
    });
  }

  async function handleAddReview(date: string, content: string, type: Review["type"], title?: string): Promise<Review> {
    const { review } = await apiClient.createReview({ date, type, content, aiInsights: "", ...(title ? { title } : {}) });
    setReviews(prev => [review, ...prev]);
    return review;
  }

  async function handleUpdateReview(id: string, data: { date?: string; content?: string; title?: string }) {
    try { await apiClient.patchReview(id, data); setReviews(prev => prev.map(r => r.id === id ? { ...r, ...data } : r)); }
    catch (e) { console.error(e); }
  }

  async function handleDeleteReview(id: string) {
    try { await apiClient.deleteReview(id); setReviews(prev => prev.filter(r => r.id !== id)); }
    catch (e) { console.error(e); }
  }

  async function handleMoveGoal(id: string, newDate: string) {
    const target = calendarGoals.find(g => g.id === id);
    setCalendarGoals(prev => prev.map(g => {
      if (g.id !== id) return g;
      if (isGoalDone(g.goalId)) return { ...g, date: newDate };
      return { ...g, date: newDate, startDate: newDate };
    }));
    setHoveredGoalRange(null);

    // 已完成目标：完成日期是其所在单元格的日期，挪动后必须同步更新（保留原时分秒）
    if (!target || !isGoalDone(target.goalId)) return;
    const goalId = target.goalId;
    const timeOf = (ts?: string | null) => (ts && ts.length > 10 ? ts.slice(10) : "T12:00:00.000Z");
    const td = todos.find(t => t.id === goalId);
    if (td) {
      const newCompletedAt = newDate + timeOf(td.completedAt);
      setTodos(prev => prev.map(t => t.id === goalId ? { ...t, completedAt: newCompletedAt } : t));
      try { await apiClient.patchTodo(goalId, { completedAt: newCompletedAt }); }
      catch (e) { console.error(e); }
      return;
    }
    const gl = goals.find(g => g.id === goalId);
    if (gl) {
      const newUpdated = newDate + timeOf(gl.updated);
      setGoals(prev => prev.map(g => g.id === goalId ? { ...g, updated: newUpdated } : g));
    }
  }
  function handleRemoveGoal(id: string) { setCalendarGoals(prev => prev.filter(g => g.id !== id)); setHoveredGoalRange(null); }
  function handleDropGoal(goalId: string, goalTitle: string, date: string, startDate?: string) {
    setCalendarGoals(prev => {
      const existing = prev.find(g => g.goalId === goalId)
        ?? prev.find(g => g.goalTitle === goalTitle && g.goalId.startsWith("temp-"));
      const filtered = prev.filter(g =>
        g.goalId !== goalId &&
        !(g.goalTitle === goalTitle && g.goalId.startsWith("temp-"))
      );
      return [...filtered, { id: newId(), goalId, goalTitle, date, startDate: startDate || existing?.startDate || date }];
    });
  }

  function prevMonth() { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }
  function nextMonth() { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }

  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  const today_iso = todayStr();

  function isGoalDone(goalId: string): boolean {
    const td = todos.find(t => t.id === goalId);
    if (td) return !!td.completedAt;
    const gl = goals.find(g => g.id === goalId);
    if (gl) return gl.status === "完成" || gl.status === "已完成";
    return false;
  }
  function getCellItems(date: Date) {
    const ds = iso(date);
    return {
      done: todos.filter(t => t.completedAt && t.completedAt.startsWith(ds)),
      reviews: reviews.filter(r => r.date === ds),
      calGoals: calendarGoals.filter(g => g.date === ds),
      ghostGoals: calendarGoals.filter(g => g.startDate === ds && g.startDate !== g.date && isGoalDone(g.goalId)),
    };
  }

  // ── hover helpers ─────────────────────────────────────────
  function showHover(e: React.MouseEvent, ds: string) {
    if (hoverLeaveRef.current) clearTimeout(hoverLeaveRef.current);
    const { top, left, width, height } = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoverCell({ date: ds, top, left, width, height });
  }
  function startHideHover() {
    hoverLeaveRef.current = setTimeout(() => setHoverCell(null), 80);
  }
  function cancelHideHover() {
    if (hoverLeaveRef.current) clearTimeout(hoverLeaveRef.current);
  }

  // ── pool item card renderer ────────────────────────────────
  function renderPoolItem(item: PoolItem) {
    const status = getPoolStatus(item);
    const title = getPoolTitle(item);
    const isDone = status === "done";
    const doneDate = isDone ? getPoolDoneDate(item) : null;
    const isEditing = !isDone && editingPoolItemId === item.data.id;

    async function savePoolTitle() {
      const newTitle = editingPoolTitle.trim();
      setEditingPoolItemId(null);
      if (!newTitle || newTitle === title) return;
      try {
        if (item.kind === "todo") {
          await apiClient.patchTodo(item.data.id, { title: newTitle });
          setTodos(prev => prev.map(t => t.id === item.data.id ? { ...t, title: newTitle } : t));
        } else {
          await apiClient.updateNote(item.data.id, { title: newTitle });
          setGoals(prev => prev.map(g => g.id === item.data.id ? { ...g, title: newTitle } : g));
        }
      } catch (e) { console.error(e); }
    }

    return (
      <div key={`${item.kind}-${item.data.id}`}
        className={cn("pool-item", isDone && "pool-item-done")}
        draggable={!isDone && !isEditing}
        onDragStart={!isDone && !isEditing ? (e => {
          e.dataTransfer.setData("goalId", item.data.id);
          e.dataTransfer.setData("goalTitle", title);
          e.dataTransfer.effectAllowed = "copy";
          setIsDragging(true);
        }) : undefined}
        onDragEnd={() => setIsDragging(false)}
      >
        <button className={cn("pool-status-btn", isDone && "pool-status-done", status === "in_progress" && "pool-status-active")}
          onClick={() => handleAdvance(item)}
          title={status === "not_started" ? "开始进行" : status === "in_progress" ? "标记完成" : "撤回到进行中"}>
          {isDone ? <RotateCcw size={10} /> : status === "not_started" ? <Play size={10} /> : <Check size={11} />}
        </button>
        <div className="pool-item-body">
          {isEditing ? (
            <input
              autoFocus
              value={editingPoolTitle}
              onChange={e => setEditingPoolTitle(e.target.value)}
              onBlur={savePoolTitle}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); savePoolTitle(); } else if (e.key === "Escape") { setEditingPoolItemId(null); } }}
              onClick={e => e.stopPropagation()}
              style={{ width: "100%", fontSize: 11, padding: "1px 4px", border: "1px solid var(--brand-500)", borderRadius: 4, outline: "none", background: "white", color: "var(--sb-text)" }}
            />
          ) : (
            <div
              className={cn("pool-item-title", isDone && "pool-item-title-done")}
              title={isDone ? title : "点击编辑"}
              onClick={!isDone ? (e => { e.stopPropagation(); setEditingPoolItemId(item.data.id); setEditingPoolTitle(title); }) : undefined}
              style={!isDone ? { cursor: "text" } : undefined}
            >{title}</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            {isDone && doneDate
              ? <span style={{ fontSize: 9, color: "#16a34a" }}>完成于 {doneDate.slice(5, 10).replace("-", "/")}</span>
              : <span className={cn("pool-status-badge", status === "not_started" && "badge-not-started", status === "in_progress" && "badge-in-progress")}>{status === "not_started" ? "未开始" : "进行中"}</span>
            }
          </div>
        </div>
        {!isDone && !isEditing && <GripVertical size={10} style={{ color: "var(--sb-border)", flexShrink: 0, cursor: "grab" }} />}
        <button className="pool-delete-btn" onClick={() => handleDeleteItem(item)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    );
  }

  // ── hover card data for current hovered date ──────────────
  const hoverData = hoverCell ? (() => {
    const ds = hoverCell.date;
    const day = (() => { const [y, m, d] = ds.split("-").map(Number); return new Date(y, m - 1, d); })();
    const revs = reviews.filter(r => r.date === ds);
    const cgoals = calendarGoals.filter(g => g.date === ds);
    const ghosts = calendarGoals.filter(g => g.startDate === ds && g.startDate !== g.date && isGoalDone(g.goalId));
    const done = todos.filter(t => t.completedAt && t.completedAt.startsWith(ds));
    function resolveGoalStatusHover(goalId: string): "not_started" | "in_progress" | "done" {
      const td = todos.find(t => t.id === goalId);
      if (td) return td.completedAt ? "done" : td.tag === "not_started" ? "not_started" : "in_progress";
      const gl = goals.find(g => g.id === goalId);
      if (gl) { const s = (gl.status || "").trim(); if (s === "进行中") return "in_progress"; if (s === "完成" || s === "已完成") return "done"; }
      return "not_started";
    }
    function getGoalCompletionDateHover(goalId: string): string | undefined {
      const td = todos.find(t => t.id === goalId);
      if (td?.completedAt) return td.completedAt.slice(0, 10);
      const gl = goals.find(g => g.id === goalId);
      if (gl && (gl.status === "完成" || gl.status === "已完成")) return gl.updated?.slice(0, 10);
      return undefined;
    }
    const allItems: AllItem[] = [
      ...done.map(t => ({ kind: "done" as const, text: t.title, id: t.id })),
      ...revs.map(r => ({ kind: "review" as const, text: r.title || r.content.slice(0, 14), id: r.id })),
      ...cgoals.map(g => {
        const gs = resolveGoalStatusHover(g.goalId);
        return { kind: "goal" as const, text: g.goalTitle, id: g.id, goalId: g.goalId, goalStatus: gs, completionDate: gs === "done" ? getGoalCompletionDateHover(g.goalId) : undefined };
      }),
      ...ghosts.map(g => ({ kind: "goal" as const, text: g.goalTitle, id: `ghost-${g.id}`, goalId: g.goalId, goalStatus: "in_progress" as const, completionDate: g.date, isGhost: true })),
    ];
    return { day, revs, cgoals, allItems };
  })() : null;

  return (
    <div className="app-layout">
      <Sidebar activePage="calendar" />
      <main className="main cal-main">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-left">
            <h1>复盘日历</h1>
            <div className="subtitle">{new Date().toLocaleDateString("zh-CN", { weekday: "long" })}</div>
          </div>
          <div className="topbar-right" style={{ gap: 8 }}>
            <div className="month-nav">
              <button className="month-btn" onClick={prevMonth}>‹</button>
              <span className="month-label">{monthName}</span>
              <button className="month-btn" onClick={nextMonth}>›</button>
            </div>
            <button className="btn-ghost btn-sm" onClick={() => { setViewYear(new Date().getFullYear()); setViewMonth(new Date().getMonth()); }}>今天</button>
            <div className="view-switch">
              {(["month", "week", "year"] as ViewMode[]).map(v => (
                <button key={v} className={cn("view-btn", view === v && "active")} onClick={() => setView(v)}>
                  {v === "month" ? "月" : v === "week" ? "周" : "年"}
                </button>
              ))}
            </div>
            <button className="btn-ghost btn-sm" onClick={rangeSummary} style={{ display: "flex", alignItems: "center", gap: 5, position: "relative" }} title={`把当前${view === "year" ? "年" : view === "week" ? "周" : "月"}范围的复盘/完成项/目标发给 AI 对话做总结`}>
              <Bot size={12} /> AI 总结
              {monthNote && (
                <span style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, whiteSpace: "nowrap", background: "#1e293b", color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 8, boxShadow: "0 6px 18px rgba(15,23,42,0.25)", zIndex: 20 }}>{monthNote}</span>
              )}
            </button>
          </div>
        </div>

        {/* CONTENT */}
        <div className="content cal-content">

          {/* ── AI 建议 ── */}
          <div className="cal-ai-box">
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--sb-primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
              <Bot size={14} style={{ color: "white" }} />
            </div>
            <div className="cal-ai-body">
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--brand-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, flexShrink: 0, opacity: 0.7 }}>第一性原理 · AI 分析</div>
              {aiSuggestionLoading
                ? <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}><ThinkingDots /><span style={{ fontSize: 12, color: "#94a3b8" }}>分析中...</span></div>
                : aiSuggestion
                  ? <div className="cal-ai-scroll"><Markdown>{aiSuggestion}</Markdown></div>
                  : <div className="cal-ai-scroll" style={{ fontSize: 12, color: "var(--brand-500)", opacity: 0.6 }}>暂无建议，请先添加目标或完成一次复盘</div>
              }
            </div>
          </div>

          <div className="cal-grid-wrap">

            {/* ── 目标池 ── */}
            <div className="pool-panel">
              <ProgressCarousel todos={todos} />
              <button className="pool-add-btn" onClick={() => setShowAddGoal(true)}>
                ＋ 添加新目标 <span className="key">⌘.</span>
              </button>
              <div className="pool-filters">
                {([
                  { key: "not_started" as FilterTab, label: `未开始 ${notStartedItems.length}` },
                  { key: "in_progress" as FilterTab, label: `进行中 ${inProgressItems.length}` },
                  { key: "done" as FilterTab, label: `已完成 ${doneItems.length}` },
                ]).map(tab => (
                  <button key={tab.key} className={cn("filter-tab", filter === tab.key && "active")} onClick={() => setFilter(tab.key)}>{tab.label}</button>
                ))}
              </div>
              <div className="pool-items">
                {loading && <div className="pool-empty">加载中...</div>}
                {!loading && countAll === 0 && <div className="pool-empty">目标池是空的，添加一个目标吧</div>}
                {showSection("not_started") && notStartedItems.length > 0 && (
                  <div className="pool-section">
                    <div className="pool-section-label" style={{ display: "flex", alignItems: "center", gap: 4 }}><Circle size={9} /> 未开始</div>
                    {notStartedItems.map(item => renderPoolItem(item))}
                  </div>
                )}
                {showSection("in_progress") && inProgressItems.length > 0 && (
                  <div className="pool-section">
                    <div className="pool-section-label active" style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={9} /> 进行中</div>
                    {inProgressItems.map(item => renderPoolItem(item))}
                  </div>
                )}
                {showSection("done") && (
                  <div className="pool-section">
                    <div className="pool-section-label done" style={{ display: "flex", alignItems: "center", gap: 4 }}><Check size={9} /> 已完成 · {monthName}</div>
                    {doneItems.length > 0
                      ? doneItems.map(item => renderPoolItem(item))
                      : <div className="pool-empty" style={{ padding: "8px 0", fontSize: 10 }}>本月暂无已完成目标</div>
                    }
                  </div>
                )}
              </div>
            </div>

            {/* ── 日历 ── */}
            <div className="calendar-grid-panel">
              <div className="cal-weekdays">
                {weekdays.map((d, i) => (<div key={d} className={cn("cal-weekday", (i === 5 || i === 6) && "weekend")}>{d}</div>))}
              </div>
              <div className="cal-cells">
                {monthDays.map((day, idx) => {
                  if (!day) return <div key={`e-${idx}`} className="cal-cell empty" />;
                  const ds = iso(day);
                  const { done, reviews: revs, calGoals, ghostGoals } = getCellItems(day);
                  const isToday = ds === today_iso;
                  const isFuture = ds > today_iso;
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const isDragOver = dragOver === ds;
                  const clearable = revs.length > 0 || calGoals.length > 0;
                  const effectiveRangeEnd = hoveredGoalRange?.endDate || todayStr();
                  const inGoalRange = hoveredGoalRange &&
                    ds >= hoveredGoalRange.startDate &&
                    ds <= effectiveRangeEnd;

                  function resolveGoalStatus(goalId: string): "not_started" | "in_progress" | "done" {
                    const td = todos.find(t => t.id === goalId);
                    if (td) return td.completedAt ? "done" : td.tag === "not_started" ? "not_started" : "in_progress";
                    const gl = goals.find(g => g.id === goalId);
                    if (gl) {
                      const s = (gl.status || "").trim();
                      if (s === "进行中") return "in_progress";
                      if (s === "完成" || s === "已完成") return "done";
                    }
                    return "not_started";
                  }
                  function getGoalCompletionDate(goalId: string): string | undefined {
                    const td = todos.find(t => t.id === goalId);
                    if (td?.completedAt) return td.completedAt.slice(0, 10);
                    const gl = goals.find(g => g.id === goalId);
                    if (gl && (gl.status === "完成" || gl.status === "已完成")) return gl.updated?.slice(0, 10);
                    return undefined;
                  }
                  const allItems: AllItem[] = [
                    ...done.map(t => ({ kind: "done" as const, text: t.title, id: t.id })),
                    ...revs.map(r => ({ kind: "review" as const, text: r.title || r.content.slice(0, 12), id: r.id })),
                    ...calGoals.map(g => {
                      const gs = resolveGoalStatus(g.goalId);
                      return { kind: "goal" as const, text: g.goalTitle.slice(0, 14), id: g.id, goalId: g.goalId, goalStatus: gs, completionDate: gs === "done" ? getGoalCompletionDate(g.goalId) : undefined };
                    }),
                    ...ghostGoals.map(g => ({ kind: "goal" as const, text: g.goalTitle.slice(0, 14), id: `ghost-${g.id}`, goalId: g.goalId, goalStatus: "in_progress" as const, completionDate: g.date, isGhost: true })),
                  ];
                  const hasHoverContent = allItems.length > 0;
                  const hasCellContent = allItems.some(i => !i.isGhost);

                  return (
                    <div key={ds}
                      className={cn("cal-cell", isToday && "today", isWeekend && "weekend-cell", isFuture && "future-cell", !isToday && !isFuture && !isWeekend && "past-cell", isDragOver && "drag-over-cell")}
                      onClick={() => openCell(day, hasCellContent ? undefined : { mode: "new-review" })}
                      onMouseEnter={e => { if (hasHoverContent) showHover(e, ds); }}
                      onMouseLeave={() => { if (hasHoverContent) startHideHover(); }}
                      onDragOver={e => { e.preventDefault(); setDragOver(ds); }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={e => {
                        e.preventDefault(); setDragOver(null);
                        const goalId = e.dataTransfer.getData("goalId");
                        const goalTitle = e.dataTransfer.getData("goalTitle");
                        const fromId = e.dataTransfer.getData("fromGoalScheduleId");
                        if (goalId && goalTitle) {
                          if (fromId) {
                            handleMoveGoal(fromId, ds);
                          } else {
                            handleDropGoal(goalId, goalTitle, ds);
                          }
                        }
                      }}
                    >
                      {inGoalRange && (() => {
                        const hr = hoveredGoalRange!;
                        const CELL_PAD = 6, HDR = 22, ITEM_H = 17, ITEM_GAP = 2;
                        const top = CELL_PAD + HDR + hr.itemIndex * (ITEM_H + ITEM_GAP) + ITEM_H / 2;
                        let bg: string;
                        if (hr.dashed) {
                          bg = `repeating-linear-gradient(to right, var(--brand-500) 0, var(--brand-500) 5px, transparent 5px, transparent 10px)`;
                        } else if (hr.status === "done" && hr.endDate) {
                          const INDIGO = [99, 102, 241], GREEN = [21, 128, 61];
                          const sMs = new Date(hr.startDate).getTime();
                          const eMs = new Date(hr.endDate).getTime();
                          const cMs = new Date(ds).getTime();
                          const total = eMs - sMs + 86400000;
                          function ic(t: number) { const c1=INDIGO,c2=GREEN; return `rgb(${Math.round(c1[0]+(c2[0]-c1[0])*t)},${Math.round(c1[1]+(c2[1]-c1[1])*t)},${Math.round(c1[2]+(c2[2]-c1[2])*t)})`; }
                          bg = `linear-gradient(to right, ${ic(Math.max(0,(cMs-sMs)/total))}, ${ic(Math.min(1,(cMs+86400000-sMs)/total))})`;
                        } else {
                          bg = "var(--brand-500)";
                        }
                        return (
                          <div style={{ position: "absolute", top, left: ds === hr.startDate ? 4 : 0, right: ds === hr.endDate ? 4 : 0,
                            height: 2, background: bg, opacity: 0.75, zIndex: 1, borderRadius: hr.dashed ? 0 : 1 }} />
                        );
                      })()}
                      <div className="cal-cell-header">
                        <span className={cn("cal-day-num", isToday && "today-num")}>{day.getDate()}</span>
                        {isToday && <span className="today-badge">TODAY</span>}
                        {clearable && (
                          <button className="cal-cell-clear-btn"
                            onClick={e => {
                              e.stopPropagation();
                              setHoverCell(null);
                              const dateStr = day.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
                              setConfirmState({
                                message: `确认清空 ${dateStr} 的所有复盘记录和已安排目标？`,
                                onConfirm: async () => {
                                  setConfirmState(null);
                                  for (const r of revs) await handleDeleteReview(r.id);
                                  for (const g of calGoals) handleRemoveGoal(g.id);
                                },
                              });
                            }}
                            title="清空此日内容"
                          >
                            清空
                          </button>
                        )}
                      </div>
                      <div className="cal-cell-items">
                        {allItems.slice(0, 3).map(item => {
                          const clickable = item.kind !== "done" && !item.isGhost;
                          const getItemPane = (): EditPaneMode | undefined => {
                            if (item.kind === "review") { const r = revs.find(r => r.id === item.id); return r ? { mode: "review", item: r } : undefined; }
                            if (item.kind === "goal" && !item.isGhost) { const g = calGoals.find(g => g.id === item.id); return g ? { mode: "goal", item: g } : undefined; }
                            return undefined;
                          };
                          return (
                            <div key={item.id}
                              className={cn(
                                "cal-item",
                                item.kind === "done" && "cal-item-done",
                                item.kind === "review" && "cal-item-review",
                                item.kind === "goal" && item.goalStatus === "done" && !item.isGhost && "cal-item-goal-done",
                                item.kind === "goal" && item.goalStatus === "in_progress" && "cal-item-goal-progress",
                                item.kind === "goal" && (item.goalStatus === "not_started" || !item.goalStatus) && !item.isGhost && "cal-item-goal",
                                item.isGhost && "cal-item-goal-progress",
                              )}
                              style={{ display: "flex", alignItems: "center", gap: 2, cursor: clickable ? "pointer" : "default", opacity: item.isGhost ? 0.5 : 1 }}
                              onClick={clickable ? e => { e.stopPropagation(); const p = getItemPane(); if (p) openCell(day, p); } : undefined}>
                              {item.kind === "done" ? <Check size={8} style={{ flexShrink: 0 }} />
                                : item.kind === "review" ? <FileText size={8} style={{ flexShrink: 0 }} />
                                : <Target size={8} style={{ flexShrink: 0 }} />}
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.text}</span>
                            </div>
                          );
                        })}
                        {allItems.length > 3 && <div className="cal-item-more">+{allItems.length - 3} 更多</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* ── Hover popover ── */}
      {hoverCell && hoverData && hoverData.allItems.length > 0 && (
        <CellHoverCard
          date={hoverData.day}
          allItems={hoverData.allItems}
          reviews={hoverData.revs}
          calGoals={hoverData.cgoals}
          position={hoverCell}
          popoverRef={popoverRef}
          onHoverEnter={cancelHideHover}
          onSelectItem={pane => {
            const [y, m, d] = hoverCell.date.split("-").map(Number);
            openCell(new Date(y, m - 1, d), pane);
          }}
          onClose={() => { setHoverCell(null); setHoveredGoalRange(null); }}
          onMoveGoal={handleMoveGoal}
          onGoalHover={setHoveredGoalRange}
        />
      )}

      {/* ── Drag edge zones ── */}
      {isDragging && (
        <>
          <div style={{ position: "fixed", left: 0, top: 0, width: 72, height: "100vh", zIndex: 100 }}
            onDragOver={e => { e.preventDefault(); switchMonthEdge("prev"); }} />
          <div style={{ position: "fixed", right: 0, top: 0, width: 72, height: "100vh", zIndex: 100 }}
            onDragOver={e => { e.preventDefault(); switchMonthEdge("next"); }} />
        </>
      )}

      {/* MODALS */}
      {showAddGoal && <AddGoalModal onAdd={handleAddGoal} onClose={() => setShowAddGoal(false)} />}

      {editDate && (
        <CellEditModal
          date={editDate}
          reviews={reviews.filter(r => r.date === iso(editDate))}
          calendarGoals={calendarGoals.filter(g => g.date === iso(editDate))}
          todos={todos}
          goals={goals}
          initialPane={editInitialPane}
          recentContext={recentContext}
          yesterdayContext={yesterdayContext}
          autoShowSummary={autoShowSummary}
          onUpdateReview={handleUpdateReview}
          onDeleteReview={handleDeleteReview}
          onMoveGoal={handleMoveGoal}
          onRemoveGoal={handleRemoveGoal}
          onAddReview={handleAddReview}
          onClose={() => { setEditDate(null); setEditInitialPane(undefined); }}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          confirmLabel="确认清空"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      <style>{`
        .app-layout { display: flex; height: 100vh; overflow: hidden; background: var(--sb-bg); }
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .topbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid var(--sb-border); background: var(--sb-surface); flex-shrink: 0; }
        .topbar h1 { font-size: 18px; font-weight: 800; color: var(--sb-text); margin: 0; }
        .subtitle { font-size: 11px; color: var(--sb-text-muted); margin-top: 2px; }
        .topbar-right { display: flex; align-items: center; gap: 8px; }
        .btn-ghost { background: transparent; border: 1px solid var(--sb-border); border-radius: 8px; padding: 8px 14px; font-size: 12px; color: var(--sb-text-secondary); cursor: pointer; }
        .btn-sm { padding: 5px 10px; font-size: 11px; }
        .month-nav { display: flex; align-items: center; gap: 8px; }
        .month-btn { width: 28px; height: 28px; border-radius: 6px; background: var(--sb-muted); border: none; cursor: pointer; font-size: 14px; color: var(--sb-text-secondary); display: flex; align-items: center; justify-content: center; }
        .month-label { font-size: 14px; font-weight: 700; color: var(--sb-text); min-width: 120px; text-align: center; }
        .view-switch { display: flex; background: var(--sb-muted); border-radius: 6px; padding: 2px; gap: 2px; }
        .view-btn { padding: 4px 12px; border-radius: 4px; border: none; background: transparent; font-size: 11px; color: var(--sb-text-muted); cursor: pointer; }
        .view-btn.active { background: white; color: var(--sb-text); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .content { flex: 1; overflow-y: auto; }

        /* Pool Panel */
        .pool-panel { background: var(--sb-surface); border: 1px solid var(--sb-border); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px; height: 100%; box-sizing: border-box; overflow: hidden; }
        .pool-items { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        .pool-add-btn { width: 100%; background: var(--sb-ink); color: #fff; border: none; border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .key { font-size: 10px; color: rgba(255,255,255,0.5); }
        .pool-filters { display: flex; gap: 4px; }
        .filter-tab { flex: 1; padding: 5px 4px; border-radius: 8px; border: 1px solid var(--sb-border); background: transparent; font-size: 9px; color: var(--sb-text-muted); cursor: pointer; white-space: nowrap; }
        .filter-tab.active { background: var(--sb-primary); color: #fff; border-color: var(--sb-primary); font-weight: 600; }
        .pool-section { display: flex; flex-direction: column; gap: 5px; }
        .pool-section-label { font-size: 9px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1px; }
        .pool-section-label.active { color: var(--brand-500); }
        .pool-section-label.done { color: #15803d; }
        .pool-empty { text-align: center; padding: 16px; color: var(--sb-text-muted); font-size: 11px; }

        /* Pool item */
        .pool-item { display: flex; align-items: center; gap: 8px; padding: 9px 10px; background: var(--sb-muted); border-radius: 10px; }
        .pool-item-done { background: #f0fdf4; }
        .pool-item-body { flex: 1; min-width: 0; }
        .pool-item-title { font-size: 12px; font-weight: 600; color: var(--sb-text); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pool-item-title-done { text-decoration: line-through; color: var(--sb-text-muted); font-weight: 500; }
        .pool-status-btn { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid #cbd5e1; background: white; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #94a3b8; }
        .pool-status-btn:hover { border-color: var(--sb-primary); color: var(--sb-primary); }
        .pool-status-active { border-color: var(--brand-500); color: var(--brand-500); background: var(--brand-50); }
        .pool-status-done { border-color: #10b981; color: #10b981; background: #f0fdf4; }
        .pool-status-done:hover { border-color: #f59e0b; color: #f59e0b; background: #fffbeb; }
        .pool-status-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 600; }
        .badge-not-started { background: #f1f5f9; color: #64748b; }
        .badge-in-progress { background: var(--brand-50); color: var(--brand-700); }
        .pool-delete-btn { background: none; border: none; cursor: pointer; opacity: 0.3; flex-shrink: 0; padding: 2px; color: var(--sb-text-muted); display: flex; align-items: center; }
        .pool-delete-btn:hover { opacity: 1; color: #ef4444; }

        /* Progress Carousel */
        .progress-carousel { background: var(--sb-ink); border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; user-select: none; }
        .progress-carousel:hover { opacity: 0.95; }
        .carousel-dots { display: flex; flex-direction: column; gap: 5px; }
        .carousel-dot { width: 6px; height: 6px; border-radius: 50%; border: none; background: #334155; cursor: pointer; padding: 0; }
        .carousel-dot.active { background: var(--sb-primary); }
        .carousel-content { display: flex; align-items: baseline; gap: 6px; flex: 1; }
        .carousel-label { font-size: 11px; color: #94a3b8; }
        .carousel-value { font-size: 32px; font-weight: 800; line-height: 1; }
        .carousel-unit { font-size: 12px; color: #94a3b8; }

        /* Calendar */
        .calendar-grid-panel { background: var(--sb-surface); border: 1px solid var(--sb-border); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
        .cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid var(--sb-border); }
        .cal-weekday { text-align: center; padding: 8px; font-size: 11px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; }
        .cal-weekday.weekend { color: var(--sb-accent); }
        .cal-cells { display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 110px; }
        .cal-cell { position: relative; overflow: hidden; border-right: 1px solid var(--sb-border); border-bottom: 1px solid var(--sb-border); padding: 6px 8px; cursor: pointer; transition: background 0.12s; }
        .cal-cell:hover { background: var(--sb-muted); }
        .cal-cell:hover .cal-cell-clear-btn { opacity: 1; }
        .cal-cell.empty { background: var(--sb-bg); cursor: default; }
        .cal-cell.weekend-cell { background: #fdf2f8; }
        .cal-cell.weekend-cell:hover { background: var(--accent-soft); }
        .cal-cell.future-cell { background: var(--sb-bg); }
        .cal-cell.past-cell { background: white; }
        .cal-cell.today { background: transparent !important; border: 2px solid var(--sb-primary); }
        .cal-cell.drag-over-cell { background: var(--brand-50) !important; border: 2px dashed var(--sb-primary); }
        .cal-cell-header { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
        .cal-day-num { font-size: 12px; font-weight: 700; color: var(--sb-text); }
        .cal-day-num.today-num { color: var(--sb-primary); font-weight: 800; }
        .today-badge { font-size: 8px; font-weight: 700; background: var(--sb-primary); color: #fff; padding: 1px 4px; border-radius: 4px; }
        .cal-cell-clear-btn { margin-left: auto; background: rgba(239,68,68,0.1); border: none; cursor: pointer; padding: 1px 5px; border-radius: 4px; opacity: 0; transition: opacity 0.12s; color: #ef4444; font-size: 9px; font-weight: 600; display: flex; align-items: center; flex-shrink: 0; }
        .cal-cell-clear-btn:hover { background: rgba(239,68,68,0.2); }
        .cal-cell.today:hover .cal-cell-clear-btn { opacity: 1; }
        .cal-cell-items { display: flex; flex-direction: column; gap: 2px; }
        .cal-item { font-size: 9px; padding: 2px 4px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
        .cal-item-done { background: #dcfce7; color: #15803d; }
        .cal-item-review { background: #ccfbf1; color: #0f766e; }
        .cal-item-ai { background: var(--brand-bg2); color: var(--brand-800); }
        .cal-item-goal { background: #f1f5f9; color: #475569; }
        .cal-item-goal-progress { background: var(--brand-50); color: var(--brand-500); }
        .cal-item-goal-done { background: #dcfce7; color: #15803d; }
        .cal-item-more { font-size: 9px; color: var(--sb-text-muted); padding: 1px 4px; }

        /* Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: white; border-radius: 16px; width: 480px; max-width: 95vw; box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--sb-border); font-size: 14px; font-weight: 700; color: var(--sb-text); }
        .modal-close { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--sb-text-muted); }
        .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
        .modal-input { width: 100%; padding: 10px 12px; border: 1px solid var(--sb-border); border-radius: 8px; font-size: 13px; font-family: inherit; outline: none; box-sizing: border-box; }
        .modal-input:focus { border-color: var(--sb-primary); }
        .modal-textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--sb-border); border-radius: 8px; font-size: 13px; font-family: inherit; outline: none; resize: vertical; min-height: 80px; box-sizing: border-box; }
        .modal-textarea:focus { border-color: var(--sb-primary); }
        .modal-row { display: flex; flex-direction: column; gap: 6px; }
        .modal-label { font-size: 11px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .tag-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .tag-chip { padding: 5px 10px; border-radius: 20px; border: 1.5px solid var(--sb-border); background: white; font-size: 11px; color: var(--sb-text-secondary); cursor: pointer; }
        .tag-chip.active { background: var(--sb-primary); color: #fff; border-color: var(--sb-primary); }
        .modal-submit { width: 100%; background: var(--sb-primary); color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .modal-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        @keyframes think-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.3; } 30% { transform: translateY(-4px); opacity: 1; } }
      `}</style>
    </div>
  );
}
