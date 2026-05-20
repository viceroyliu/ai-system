"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type Todo, type Review } from "@/lib/api";

// ─── helpers ────────────────────────────────────────────────
function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}
function today() {
  return iso(new Date());
}
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
function tagLabel(t: string) {
  const m: Record<string, string> = {
    study: "学习", work: "工作", exercise: "运动",
    reading: "阅读", reflection: "反思",
  };
  return m[t] || t;
}
function tagEmoji(t: string) {
  const m: Record<string, string> = {
    study: "📚", work: "💼", exercise: "🏃",
    reading: "📖", reflection: "💭",
  };
  return m[t] || "📋";
}
function priColor(p: string) {
  const m: Record<string, string> = {
    high: "#fef3c7", medium: "#eef2ff", low: "#f1f5f9",
  };
  return m[p] || "#f1f5f9";
}
function priText(p: string) {
  const m: Record<string, string> = {
    high: "高优先", medium: "中", low: "低",
  };
  return m[p] || "中";
}
function priTextColor(p: string) {
  const m: Record<string, string> = {
    high: "#92400e", medium: "#4338ca", low: "#475569",
  };
  return m[p] || "#475569";
}

function formatMinutes(m: number) {
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return mins > 0 ? `${h} 小时 ${mins} 分钟` : `${h} 小时`;
}

function formatDate(d: Date) {
  return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
}

function getMonthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Array<Date | null> = [];
  // fill leading nulls for Monday-start weeks
  let dow = first.getDay(); // 0=Sun
  // convert to Monday-start: Mon=0, Sun=6
  const mondayStart = dow === 0 ? 6 : dow - 1;
  for (let i = 0; i < mondayStart; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  // pad to complete weeks
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function isWeekend(d: Date) {
  return d.getDay() === 0 || d.getDay() === 6;
}
function isFuture(d: Date) {
  return iso(d) > today();
}
function isPast(d: Date) {
  return iso(d) < today();
}
function isToday(d: Date) {
  return iso(d) === today();
}

// ─── component types ────────────────────────────────────────
interface AddModalProps {
  onAdd: (t: Omit<Todo, "id" | "completedAt" | "createdAt">) => void;
  onClose: () => void;
}

function AddTodoModal({ onAdd, onClose }: AddModalProps) {
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState<Todo["tag"]>("work");
  const [priority, setPriority] = useState<Todo["priority"]>("medium");
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd({ title: title.trim(), tag, priority, estimatedMinutes });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>🎯 添加新行动</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <input
            ref={ref}
            className="modal-input"
            placeholder="行动标题，如：完成 useEffect 清理函数学习"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <div className="modal-row">
            <label className="modal-label">类别</label>
            <div className="tag-chips">
              {(["study","work","exercise","reading","reflection"] as const).map(t => (
                <button key={t} type="button"
                  className={cn("tag-chip", tag === t && "active")}
                  onClick={() => setTag(t)}>
                  {tagEmoji(t)} {tagLabel(t)}
                </button>
              ))}
            </div>
          </div>
          <div className="modal-row">
            <label className="modal-label">优先级</label>
            <div className="tag-chips">
              {(["high","medium","low"] as const).map(p => (
                <button key={p} type="button"
                  className={cn("tag-chip", priority === p && "active")}
                  onClick={() => setPriority(p)}
                  style={priority === p ? { background: priColor(p), color: priTextColor(p), border: "1.5px solid currentColor" } : {}}>
                  {priText(p)}
                </button>
              ))}
            </div>
          </div>
          <div className="modal-row">
            <label className="modal-label">预估时长</label>
            <select className="modal-select" value={estimatedMinutes}
              onChange={e => setEstimatedMinutes(Number(e.target.value))}>
              <option value={15}>15 分钟</option>
              <option value={30}>30 分钟</option>
              <option value={45}>45 分钟</option>
              <option value={60}>1 小时</option>
              <option value={90}>1.5 小时</option>
              <option value={120}>2 小时</option>
              <option value={180}>3 小时</option>
            </select>
          </div>
          <button type="submit" className="modal-submit" disabled={!title.trim()}>
            ➕ 添加到行动池
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── main page ──────────────────────────────────────────────
type FilterTab = "all" | "active" | "done";
type ViewMode = "month" | "week" | "year";

const TEMPLATES = [
  { label: "📚 学习", tag: "study" as const, priority: "high" as const, estimatedMinutes: 60 },
  { label: "💼 工作", tag: "work" as const, priority: "medium" as const, estimatedMinutes: 120 },
  { label: "🏃 运动", tag: "exercise" as const, priority: "high" as const, estimatedMinutes: 30 },
  { label: "📖 阅读", tag: "reading" as const, priority: "low" as const, estimatedMinutes: 45 },
  { label: "💭 反思", tag: "reflection" as const, priority: "medium" as const, estimatedMinutes: 20 },
];

export default function CalendarPage() {
  const router = useRouter();

  const [todos, setTodos] = useState<Todo[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [view, setView] = useState<ViewMode>("month");
  const [today_date] = useState(new Date());
  const [viewYear, setViewYear] = useState(today_date.getFullYear());
  const [viewMonth, setViewMonth] = useState(today_date.getMonth());

  const monthDays = getMonthDays(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("zh-CN", { year: "numeric", month: "long" });

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        apiClient.getTodos(),
        apiClient.getReviews(),
      ]);
      setTodos(t.todos);
      setReviews(r.reviews);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // keyboard shortcut ⌘+
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "+") {
        e.preventDefault();
        setShowAdd(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleAddTodo(data: Omit<Todo, "id" | "completedAt" | "createdAt">) {
    const { todo } = await apiClient.createTodo(data);
    setTodos(prev => [todo, ...prev]);
  }

  async function handleToggleComplete(id: string, completed: boolean) {
    await apiClient.patchTodo(id, { completed });
    setTodos(prev => prev.map(t => t.id === id
      ? { ...t, completedAt: completed ? new Date().toISOString() : null }
      : t));
  }

  async function handleDeleteTodo(id: string) {
    await apiClient.deleteTodo(id);
    setTodos(prev => prev.filter(t => t.id !== id));
  }

  async function handleAddReview(date: string, content: string) {
    const { review } = await apiClient.createReview({ date, type: "daily", content, aiInsights: "" });
    setReviews(prev => [review, ...prev]);
  }

  async function handleDeleteReview(id: string) {
    await apiClient.deleteReview(id);
    setReviews(prev => prev.filter(r => r.id !== id));
  }

  // ─── derived data ───────────────────────────────────────────
  const activeTodos = todos.filter(t => !t.completedAt);
  const doneTodos = todos.filter(t => t.completedAt);
  const completedToday = doneTodos.filter(t =>
    t.completedAt && t.completedAt.slice(0, 10) === today()
  );
  const inProgressToday = activeTodos.slice(0, 5);
  const doneInPool = doneTodos.slice(0, 10);

  const completedCount = completedToday.length;
  const totalCount = completedCount + inProgressToday.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // streak: consecutive days with at least one completed TODO
  const streak = (() => {
    let count = 0;
    const d = new Date();
    while (true) {
      const ds = iso(d);
      const hasDone = todos.some(t => t.completedAt && t.completedAt.slice(0, 10) === ds);
      if (!hasDone) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  })();

  const filterTodos = filter === "all" ? todos
    : filter === "active" ? activeTodos
    : doneTodos;

  // ─── calendar helpers ──────────────────────────────────────
  function getCellItems(date: Date) {
    const ds = iso(date);
    const done = doneTodos.filter(t => t.completedAt && t.completedAt.slice(0, 10) === ds);
    const revs = reviews.filter(r => r.date === ds);
    return { done, reviews: revs };
  }

  // AI suggestion: find categories with gap > 3 days
  const aiSuggestion = (() => {
    const now = new Date();
    const gaps: Record<string, number> = {};
    for (const t of todos) {
      if (!t.completedAt) continue;
      const daysSince = Math.floor((now.getTime() - new Date(t.completedAt).getTime()) / 86400000);
      const key = t.tag;
      if (!gaps[key] || daysSince > gaps[key]) gaps[key] = daysSince;
    }
    const maxTag = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0];
    if (!maxTag || maxTag[1] < 3) return null;
    return { tag: maxTag[0], days: maxTag[1] };
  })();

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const weekNum = Math.ceil((viewMonth + 1) / 4);

  // weekday headers Monday-first
  const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

  return (
    <div className="app-layout">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark"><span>NX</span></div>
          <div><div className="logo-text">Nexus</div><div className="logo-sub">AI System · v3.1</div></div>
        </div>
        <div className="search-box" onClick={() => router.push("/search")}>
          <span>🔍 搜索知识库...</span><span className="key">⌘K</span>
        </div>
        <div className="nav-section">
          <div className="nav-label">Main</div>
          <div className="nav-item" onClick={() => router.push("/")}><span>🏠</span> 概览</div>
          <div className="nav-item" onClick={() => router.push("/chat")}><span>💬</span> AI 对话</div>
          <div className="nav-item active" onClick={() => router.push("/calendar")}><span>📅</span> 日历 &amp; 复盘</div>
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
          <select className="model-select" defaultValue="">
            <option value="" disabled>选择模型...</option>
            <option value="qwen2.5:14b-instruct">qwen2.5:14b-instruct</option>
            <option value="qwen3:14b">qwen3:14b</option>
            <option value="qwen3:32b">qwen3:32b</option>
          </select>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-left">
            <h1>📅 日历 &amp; 复盘</h1>
            <div className="subtitle">{formatDate(today_date)} · 第 {weekNum} 周</div>
          </div>
          <div className="topbar-right" style={{ gap: 8 }}>
            {/* month nav */}
            <div className="month-nav">
              <button className="month-btn" onClick={prevMonth}>‹</button>
              <span className="month-label">{monthName}</span>
              <button className="month-btn" onClick={nextMonth}>›</button>
            </div>
            <button className="btn-ghost btn-sm" onClick={() => { setViewYear(today_date.getFullYear()); setViewMonth(today_date.getMonth()); }}>
              今天
            </button>
            {/* view switcher */}
            <div className="view-switch">
              {(["month","week","year"] as ViewMode[]).map(v => (
                <button key={v} className={cn("view-btn", view === v && "active")}
                  onClick={() => setView(v)}>
                  {v === "month" ? "月" : v === "week" ? "周" : "年"}
                </button>
              ))}
            </div>
            <button className="btn-ghost btn-sm" onClick={() => router.push("/chat")}>
              🤖 AI 月度总结
            </button>
            <button className="btn-primary btn-sm" onClick={() => setShowAdd(true)}>
              ⚡ 同步本月到 Notion
            </button>
          </div>
        </div>

        {/* CONTENT: left panel + right calendar */}
        <div className="content" style={{ padding: "20px 24px", gap: 20, display: "flex", flexDirection: "column" }}>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 12 }}>
            {[
              { label: "今日完成", value: completedCount, sub: `/ ${totalCount} 行动`, color: "var(--sb-primary)" },
              { label: "连续活跃", value: streak, sub: "天", color: "#f59e0b" },
              { label: "本周完成", value: doneTodos.filter(t => {
                const w = new Date(); w.setDate(w.getDate() - 7);
                return t.completedAt && new Date(t.completedAt) >= w;
              }).length, sub: "项", color: "#10b981" },
              { label: "本月复盘", value: reviews.filter(r => {
                const m = new Date(viewYear, viewMonth, 1);
                return new Date(r.date) >= m;
              }).length, sub: "篇", color: "#ec4899" },
            ].map(stat => (
              <div key={stat.label} style={{ flex: 1, background: "var(--sb-surface)", border: "1px solid var(--sb-border)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 10, color: "var(--sb-text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stat.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</span>
                  <span style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>{stat.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Two-column layout */}
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>

            {/* ── LEFT: TODO POOL ── */}
            <div className="todo-panel">

              {/* header */}
              <div className="todo-panel-header">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb-text)" }}>🎯 今日行动池</div>
                  <div style={{ fontSize: 10, color: "var(--sb-text-muted)", marginTop: 2 }}>
                    {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })} · 完成后自动归档到日历
                  </div>
                </div>
              </div>

              {/* progress */}
              <div className="todo-progress">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--sb-text-muted)" }}>今日进度</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--sb-primary)" }}>{progressPct}%</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "var(--sb-text)" }}>{completedCount}</span>
                  <span style={{ fontSize: 11, color: "var(--sb-text-muted)" }}>/ {totalCount} 已完成</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--sb-border)" }}>
                    <div style={{ width: `${progressPct}%`, height: "100%", borderRadius: 3, background: "var(--sb-primary)", transition: "width 0.3s" }} />
                  </div>
                </div>
              </div>

              {/* add button */}
              <button className="todo-add-btn" onClick={() => setShowAdd(true)}>
                ＋ 添加新行动 <span className="key">⌘+</span>
              </button>

              {/* filter tabs */}
              <div className="todo-filters">
                {([
                  { key: "all" as FilterTab, label: `全部 ${todos.length}` },
                  { key: "active" as FilterTab, label: `进行中 ${activeTodos.length}` },
                  { key: "done" as FilterTab, label: `已完成 ${doneTodos.length}` },
                ]).map(tab => (
                  <button key={tab.key}
                    className={cn("filter-tab", filter === tab.key && "active")}
                    onClick={() => setFilter(tab.key)}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* in-progress section */}
              {filter !== "done" && inProgressToday.length > 0 && (
                <div className="todo-section">
                  <div className="todo-section-label">⏳ 进行中</div>
                  {inProgressToday.map(todo => (
                    <div key={todo.id} className="todo-item">
                      <button className="todo-check" onClick={() => handleToggleComplete(todo.id, true)}>○</button>
                      <div className="todo-item-body">
                        <div className="todo-item-title">{todo.title}</div>
                        <div style={{ fontSize: 10, color: "var(--sb-text-muted)" }}>
                          {tagEmoji(todo.tag)} {tagLabel(todo.tag)} · 预计 {formatMinutes(todo.estimatedMinutes)}
                        </div>
                        <div style={{ display: "inline-block", marginTop: 4, padding: "1px 6px", borderRadius: 4, background: priColor(todo.priority), color: priTextColor(todo.priority), fontSize: 9, fontWeight: 600 }}>
                          {priText(todo.priority)}
                        </div>
                      </div>
                      <button className="todo-delete" onClick={() => handleDeleteTodo(todo.id)}>🗑</button>
                    </div>
                  ))}
                </div>
              )}

              {/* completed section */}
              {filter === "all" && doneInPool.length > 0 && (
                <div className="todo-section">
                  <div className="todo-section-label done">✓ 已完成 · 已归档到日历</div>
                  {doneInPool.map(todo => (
                    <div key={todo.id} className="todo-item done">
                      <button className="todo-check done" onClick={() => handleToggleComplete(todo.id, false)}>✓</button>
                      <div className="todo-item-body">
                        <div className="todo-item-title done">{todo.title}</div>
                        <div style={{ fontSize: 9, color: "#16a34a" }}>
                          📍 已显示在 {todo.completedAt?.slice(5, 10).replace("-", "/")} 日历格
                        </div>
                      </div>
                      <button className="todo-delete" onClick={() => handleDeleteTodo(todo.id)}>🗑</button>
                    </div>
                  ))}
                </div>
              )}

              {filter === "done" && doneTodos.map(todo => (
                <div key={todo.id} className="todo-item done">
                  <button className="todo-check done" onClick={() => handleToggleComplete(todo.id, false)}>✓</button>
                  <div className="todo-item-body">
                    <div className="todo-item-title done">{todo.title}</div>
                    <div style={{ fontSize: 9, color: "#16a34a" }}>📍 {todo.completedAt?.slice(5, 10).replace("-", "/")}</div>
                  </div>
                  <button className="todo-delete" onClick={() => handleDeleteTodo(todo.id)}>🗑</button>
                </div>
              ))}

              {loading && <div className="todo-empty">加载中...</div>}
              {!loading && filterTodos.length === 0 && (
                <div className="todo-empty">
                  {filter === "done" ? "还没有完成任何行动" : "行动池是空的，添加一个吧"}
                </div>
              )}

              {/* AI suggestion */}
              {aiSuggestion && (
                <div className="ai-suggestion">
                  <div className="ai-suggestion-title">🤖 AI 建议</div>
                  <div className="ai-suggestion-body">
                    你已 <strong>{aiSuggestion.days} 天</strong> 没做「{tagLabel(aiSuggestion.tag)}」类行动
                  </div>
                  <div className="ai-suggestion-cta" onClick={() => handleAddTodo({
                    title: `${tagLabel(aiSuggestion.tag)} 30 分钟`,
                    tag: aiSuggestion.tag as Todo["tag"],
                    priority: "medium",
                    estimatedMinutes: 30,
                  })}>
                    + 加入行动池
                  </div>
                </div>
              )}

              {/* quick templates */}
              <div className="quick-templates">
                <div className="quick-templates-label">⚡ 快捷模板</div>
                <div className="quick-templates-grid">
                  {TEMPLATES.map(t => (
                    <button key={t.label} className="template-chip"
                      onClick={() => handleAddTodo({ title: `${tagLabel(t.tag)} 30 分钟`, tag: t.tag, priority: t.priority, estimatedMinutes: t.estimatedMinutes })}>
                      {t.label}
                    </button>
                  ))}
                  <button className="template-chip" onClick={() => setShowAdd(true)}>+ 自定义</button>
                </div>
              </div>
            </div>

            {/* ── RIGHT: CALENDAR ── */}
            <div className="calendar-grid-panel">
              {/* weekday headers */}
              <div className="cal-weekdays">
                {weekdayLabels.map((d, i) => (
                  <div key={d} className={cn("cal-weekday", (i === 5 || i === 6) && "weekend")}>{d}</div>
                ))}
              </div>

              {/* calendar cells */}
              <div className="cal-cells">
                {monthDays.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} className="cal-cell empty" />;

                  const { done, reviews } = getCellItems(day);
                  const past = isPast(day);
                  const future = isFuture(day);
                  const weekend = isWeekend(day);
                  const todayCell = isToday(day);
                  const allItems = [
                    ...done.map(t => ({ type: "done" as const, text: t.title, id: t.id })),
                    ...reviews.map(r => ({ type: r.type === "weekly" || r.type === "monthly" ? "ai" as const : "review" as const, text: r.content.slice(0, 20), id: r.id })),
                  ];

                  return (
                    <div key={iso(day)}
                      className={cn("cal-cell", todayCell && "today", weekend && "weekend-cell", future && "future-cell", past && !weekend && "past-cell")}
                      onClick={() => {
                        const text = prompt(`${day.getMonth() + 1}/${day.getDate()} - 添加复盘内容：`);
                        if (text) handleAddReview(iso(day), text);
                      }}>
                      <div className="cal-cell-header">
                        <span className={cn("cal-day-num", todayCell && "today-num")}>{day.getDate()}</span>
                        {todayCell && <span className="today-badge">TODAY</span>}
                      </div>
                      <div className="cal-cell-items">
                        {allItems.slice(0, 3).map(item => (
                          <div key={item.id}
                            className={cn("cal-item", item.type === "done" && "cal-item-done", item.type === "review" && "cal-item-review", item.type === "ai" && "cal-item-ai")}>
                            {item.type === "done" ? "✓ " : item.type === "review" ? "📝 " : "🤖 "}
                            {item.text}
                          </div>
                        ))}
                        {allItems.length > 3 && (
                          <div className="cal-item-more">+{allItems.length - 3} 更多</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* ADD MODAL */}
      {showAdd && (
        <AddTodoModal
          onAdd={handleAddTodo}
          onClose={() => setShowAdd(false)}
        />
      )}

      <style>{`
        .app-layout { display: flex; height: 100vh; overflow: hidden; background: var(--sb-bg); }
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .topbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid var(--sb-border); background: var(--sb-surface); flex-shrink: 0; }
        .topbar h1 { font-size: 18px; font-weight: 800; color: var(--sb-text); margin: 0; }
        .subtitle { font-size: 11px; color: var(--sb-text-muted); margin-top: 2px; }
        .topbar-right { display: flex; align-items: center; gap: 8px; }
        .btn-primary { background: var(--sb-primary); color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .btn-primary:hover { opacity: 0.9; }
        .btn-ghost { background: transparent; border: 1px solid var(--sb-border); border-radius: 8px; padding: 8px 14px; font-size: 12px; color: var(--sb-text-secondary); cursor: pointer; }
        .btn-sm { padding: 5px 10px; font-size: 11px; }
        .month-nav { display: flex; align-items: center; gap: 8px; }
        .month-btn { width: 28px; height: 28px; border-radius: 6px; background: var(--sb-muted); border: none; cursor: pointer; font-size: 14px; color: var(--sb-text-secondary); display: flex; align-items: center; justify-content: center; }
        .month-label { font-size: 14px; font-weight: 700; color: var(--sb-text); min-width: 120px; text-align: center; }
        .view-switch { display: flex; background: var(--sb-muted); border-radius: 6px; padding: 2px; gap: 2px; }
        .view-btn { padding: 4px 12px; border-radius: 4px; border: none; background: transparent; font-size: 11px; color: var(--sb-text-muted); cursor: pointer; }
        .view-btn.active { background: white; color: var(--sb-text); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .content { flex: 1; overflow-y: auto; }

        /* TODO Panel */
        .todo-panel { background: var(--sb-surface); border: 1px solid var(--sb-border); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .todo-panel-header { }
        .todo-progress { background: var(--sb-muted); border-radius: 10px; padding: 10px 12px; }
        .todo-add-btn { width: 100%; background: var(--sb-ink); color: #fff; border: none; border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .key { font-size: 10px; color: var(--sb-text-muted); }
        .todo-filters { display: flex; gap: 6px; }
        .filter-tab { flex: 1; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--sb-border); background: transparent; font-size: 10px; color: var(--sb-text-muted); cursor: pointer; }
        .filter-tab.active { background: var(--sb-primary); color: #fff; border-color: var(--sb-primary); font-weight: 600; }
        .todo-section { display: flex; flex-direction: column; gap: 6px; }
        .todo-section-label { font-size: 9px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
        .todo-section-label.done { color: #15803d; }
        .todo-item { display: flex; align-items: flex-start; gap: 8px; padding: 10px; background: var(--sb-muted); border-radius: 10px; }
        .todo-item.done { background: #f0fdf4; }
        .todo-check { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid #cbd5e1; background: white; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; color: #cbd5e1; }
        .todo-check.done { background: #10b981; border-color: #10b981; color: white; }
        .todo-item-body { flex: 1; min-width: 0; }
        .todo-item-title { font-size: 12px; font-weight: 600; color: var(--sb-text); line-height: 1.4; }
        .todo-item-title.done { text-decoration: line-through; color: var(--sb-text-muted); font-weight: 500; }
        .todo-delete { background: none; border: none; cursor: pointer; font-size: 12px; opacity: 0.4; flex-shrink: 0; padding: 2px; }
        .todo-delete:hover { opacity: 1; }
        .todo-empty { text-align: center; padding: 20px; color: var(--sb-text-muted); font-size: 11px; }
        .ai-suggestion { background: #ede9fe; border-radius: 12px; padding: 12px; }
        .ai-suggestion-title { font-size: 10px; font-weight: 700; color: #6d28d9; margin-bottom: 6px; }
        .ai-suggestion-body { font-size: 11px; color: #4c1d95; margin-bottom: 8px; line-height: 1.5; }
        .ai-suggestion-cta { display: inline-block; background: #6d28d9; color: white; font-size: 10px; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
        .quick-templates { background: var(--sb-muted); border-radius: 10px; padding: 10px; }
        .quick-templates-label { font-size: 10px; font-weight: 700; color: var(--sb-text-muted); margin-bottom: 8px; }
        .quick-templates-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .template-chip { padding: 5px 8px; border-radius: 20px; border: 1px solid var(--sb-border); background: white; font-size: 10px; color: var(--sb-text-secondary); cursor: pointer; text-align: center; }

        /* Calendar */
        .calendar-grid-panel { background: var(--sb-surface); border: 1px solid var(--sb-border); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
        .cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid var(--sb-border); }
        .cal-weekday { text-align: center; padding: 8px; font-size: 11px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; }
        .cal-weekday.weekend { color: #ec4899; }
        .cal-cells { display: grid; grid-template-columns: repeat(7, 1fr); flex: 1; }
        .cal-cell { min-height: 110px; border-right: 1px solid var(--sb-border); border-bottom: 1px solid var(--sb-border); padding: 6px 8px; cursor: pointer; transition: background 0.15s; }
        .cal-cell:hover { background: var(--sb-muted); }
        .cal-cell.empty { background: var(--sb-bg); cursor: default; }
        .cal-cell.weekend-cell { background: #fdf2f8; }
        .cal-cell.weekend-cell:hover { background: #fce7f3; }
        .cal-cell.future-cell { background: var(--sb-bg); }
        .cal-cell.past-cell { background: white; }
        .cal-cell.today { background: var(--sb-ink) !important; border: 2px solid var(--sb-primary); }
        .cal-cell-header { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
        .cal-day-num { font-size: 12px; font-weight: 700; color: var(--sb-text); }
        .cal-day-num.today-num { color: #fff; }
        .today-badge { font-size: 8px; font-weight: 700; background: var(--sb-primary); color: #fff; padding: 1px 4px; border-radius: 4px; }
        .cal-cell-items { display: flex; flex-direction: column; gap: 2px; }
        .cal-item { font-size: 9px; padding: 2px 4px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
        .cal-item-done { background: #dcfce7; color: #15803d; }
        .cal-item-review { background: #fef3c7; color: #92400e; }
        .cal-item-ai { background: #ede9fe; color: #6d28d9; }
        .cal-item-more { font-size: 9px; color: var(--sb-text-muted); padding: 1px 4px; }

        /* Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: white; border-radius: 16px; width: 480px; max-width: 95vw; box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--sb-border); font-size: 14px; font-weight: 700; color: var(--sb-text); }
        .modal-close { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--sb-text-muted); }
        .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
        .modal-input { width: 100%; padding: 10px 12px; border: 1px solid var(--sb-border); border-radius: 8px; font-size: 13px; font-family: inherit; outline: none; box-sizing: border-box; }
        .modal-input:focus { border-color: var(--sb-primary); }
        .modal-row { display: flex; flex-direction: column; gap: 6px; }
        .modal-label { font-size: 11px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .tag-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .tag-chip { padding: 5px 10px; border-radius: 20px; border: 1.5px solid var(--sb-border); background: white; font-size: 11px; color: var(--sb-text-secondary); cursor: pointer; }
        .tag-chip.active { background: var(--sb-primary); color: #fff; border-color: var(--sb-primary); }
        .modal-select { padding: 7px 10px; border: 1px solid var(--sb-border); border-radius: 8px; font-size: 12px; font-family: inherit; outline: none; background: var(--sb-muted); }
        .modal-submit { width: 100%; background: var(--sb-primary); color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .modal-submit:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
