"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type Todo, type Review } from "@/lib/api";

// ─── helpers ────────────────────────────────────────────────
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function todayStr() { return iso(new Date()); }
function cn(...args: (string | boolean | undefined | null)[]) { return args.filter(Boolean).join(" "); }
function tagLabel(t: string) {
  return { study: "学习", work: "工作", exercise: "运动", reading: "阅读", reflection: "反思" }[t] ?? t;
}
function tagEmoji(t: string) {
  return { study: "📚", work: "💼", exercise: "🏃", reading: "📖", reflection: "💭" }[t] ?? "📋";
}
function priStyle(p: string) {
  const m: Record<string, { bg: string; color: string }> = {
    high: { bg: "#fef3c7", color: "#92400e" },
    medium: { bg: "#eef2ff", color: "#4338ca" },
    low: { bg: "#f1f5f9", color: "#475569" },
  };
  return m[p] ?? m.medium;
}
function priText(p: string) {
  return { high: "高优先", medium: "中", low: "低" }[p] ?? "中";
}

function getMonthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Array<Date | null> = [];
  const dow = first.getDay(); // 0=Sun
  const mondayStart = dow === 0 ? 6 : dow - 1;
  for (let i = 0; i < mondayStart; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function formatDateLong(d: Date) {
  return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
}

// ─── AddTodoModal ────────────────────────────────────────────
interface AddTodoModalProps {
  onAdd: (title: string, tag: Todo["tag"], priority: Todo["priority"]) => void;
  onClose: () => void;
}

function AddTodoModal({ onAdd, onClose }: AddTodoModalProps) {
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState<Todo["tag"]>("work");
  const [priority, setPriority] = useState<Todo["priority"]>("medium");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title.trim(), tag, priority);
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
            autoFocus
            className="modal-input"
            placeholder="行动标题，如：完成 useEffect 清理函数学习"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <div className="modal-row">
            <label className="modal-label">类别</label>
            <div className="tag-chips">
              {(["study", "work", "exercise", "reading", "reflection"] as const).map(t => (
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
              {(["high", "medium", "low"] as const).map(p => {
                const s = priStyle(p);
                return (
                  <button key={p} type="button"
                    className={cn("tag-chip", priority === p && "active")}
                    style={priority === p ? { background: s.bg, color: s.color, border: `1.5px solid ${s.color}` } : {}}
                    onClick={() => setPriority(p)}>
                    {priText(p)}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="submit" className="modal-submit" disabled={!title.trim()}>
            ➕ 添加到行动池
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── AddReviewModal ─────────────────────────────────────────
interface AddReviewModalProps {
  date: Date;
  onAdd: (date: string, content: string, type: Review["type"]) => void;
  onClose: () => void;
}

function AddReviewModal({ date, onAdd, onClose }: AddReviewModalProps) {
  const [content, setContent] = useState("");
  const [rtype, setRtype] = useState<Review["type"]>("daily");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    onAdd(iso(date), content.trim(), rtype);
    onClose();
  }

  const dateStr = date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>📝 添加复盘 — {dateStr}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="modal-row">
            <label className="modal-label">类型</label>
            <div className="tag-chips">
              {([["daily","日"],["weekly","周"],["monthly","月"]] as const).map(([v, l]) => (
                <button key={v} type="button"
                  className={cn("tag-chip", rtype === v && "active")}
                  onClick={() => setRtype(v as Review["type"])}>
                  {v === "daily" ? "📅 日" : v === "weekly" ? "📆 周" : "📊 月"} {l}复盘
                </button>
              ))}
            </div>
          </div>
          <textarea
            autoFocus
            className="modal-textarea"
            placeholder={`写一下今天的复盘内容...`}
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
          />
          <button type="submit" className="modal-submit" disabled={!content.trim()}>
            ✓ 添加复盘
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── progress carousel strip ────────────────────────────────
type CarouselPeriod = "today" | "week" | "month" | "streak";

function ProgressCarousel({ todos, reviews }: { todos: Todo[]; reviews: Review[] }) {
  const [period, setPeriod] = useState<CarouselPeriod>("today");

  const now = new Date();

  const done = (start: Date, end: Date) =>
    todos.filter(t => t.completedAt && new Date(t.completedAt) >= start && new Date(t.completedAt) <= end).length;

  const todayDone = done(new Date(now.getFullYear(), now.getMonth(), now.getDate()), now);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekDone = done(weekStart, now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDone = done(monthStart, now);

  let streak = 0;
  {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    while (true) {
      const ds = iso(d);
      const hasDone = todos.some(t => t.completedAt && t.completedAt.slice(0, 10) === ds);
      if (!hasDone) break;
      streak++;
      d.setDate(d.getDate() - 1);
      d.setHours(23, 59, 59, 999);
    }
  }

  const stats: Record<CarouselPeriod, { label: string; value: number; color: string }> = {
    today: { label: "今日完成", value: todayDone, color: "#6366f1" },
    week: { label: "本周完成", value: weekDone, color: "#10b981" },
    month: { label: "本月完成", value: monthDone, color: "#f59e0b" },
    streak: { label: "连续活跃", value: streak, color: "#ec4899" },
  };

  const cur = stats[period];

  return (
    <div className="progress-carousel">
      <div className="carousel-dots">
        {(["today", "week", "month", "streak"] as CarouselPeriod[]).map(p => (
          <button key={p}
            className={cn("carousel-dot", period === p && "active")}
            onClick={() => setPeriod(p)} />
        ))}
      </div>
      <div className="carousel-content">
        <span className="carousel-label">{cur.label}</span>
        <span className="carousel-value" style={{ color: cur.color }}>{cur.value}</span>
        <span className="carousel-unit">项</span>
      </div>
    </div>
  );
}

// ─── main ───────────────────────────────────────────────────
type FilterTab = "all" | "active" | "done";
type ViewMode = "month" | "week" | "year";

const TEMPLATES = [
  { label: "📚 学习", tag: "study" as const, priority: "high" as const },
  { label: "💼 工作", tag: "work" as const, priority: "medium" as const },
  { label: "🏃 运动", tag: "exercise" as const, priority: "high" as const },
  { label: "📖 阅读", tag: "reading" as const, priority: "low" as const },
  { label: "💭 反思", tag: "reflection" as const, priority: "medium" as const },
];

export default function CalendarPage() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTodo, setShowAddTodo] = useState(false);
  const [reviewDate, setReviewDate] = useState<Date | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [view, setView] = useState<ViewMode>("month");
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());

  const monthDays = getMonthDays(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("zh-CN", { year: "numeric", month: "long" });

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([apiClient.getTodos(), apiClient.getReviews()]);
      setTodos(t.todos);
      setReviews(r.reviews);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ⌘+ shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "+") {
        e.preventDefault();
        setShowAddTodo(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleAddTodo(title: string, tag: Todo["tag"], priority: Todo["priority"]) {
    try {
      const { todo } = await apiClient.createTodo({ title, tag, priority, estimatedMinutes: 60 });
      setTodos(prev => [todo, ...prev]);
    } catch (e) {
      console.error("Failed to add todo:", e);
    }
  }

  async function handleToggleComplete(id: string, completed: boolean) {
    try {
      await apiClient.patchTodo(id, { completed });
      setTodos(prev => prev.map(t => t.id === id
        ? { ...t, completedAt: completed ? new Date().toISOString() : null }
        : t));
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteTodo(id: string) {
    try {
      await apiClient.deleteTodo(id);
      setTodos(prev => prev.filter(t => t.id !== id));
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAddReview(date: string, content: string, type: Review["type"]) {
    try {
      const { review } = await apiClient.createReview({ date, type, content, aiInsights: "" });
      setReviews(prev => [review, ...prev]);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteReview(id: string) {
    try {
      await apiClient.deleteReview(id);
      setReviews(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.error(e);
    }
  }

  // derived
  const activeTodos = todos.filter(t => !t.completedAt);
  const doneTodos = todos.filter(t => t.completedAt);
  const filterTodos = filter === "all" ? todos
    : filter === "active" ? activeTodos
    : doneTodos;
  const inProgress = activeTodos.slice(0, 8);
  const donePool = doneTodos.slice(0, 8);

  // streak for AI suggestion
  const aiSuggestion = (() => {
    const now = new Date();
    const gaps: Record<string, number> = {};
    for (const t of todos) {
      if (!t.completedAt) continue;
      const daysSince = Math.floor((now.getTime() - new Date(t.completedAt).getTime()) / 86400000);
      if (!gaps[t.tag] || daysSince > gaps[t.tag]) gaps[t.tag] = daysSince;
    }
    const max = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0];
    if (!max || max[1] < 3) return null;
    return { tag: max[0], days: max[1] };
  })();

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  const today_iso = todayStr();

  function getCellItems(date: Date) {
    const ds = iso(date);
    const done = doneTodos.filter(t => t.completedAt && t.completedAt.slice(0, 10) === ds);
    const revs = reviews.filter(r => r.date === ds);
    return { done, reviews: revs };
  }

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark"><span>AI</span></div>
          <div><div className="logo-text">AI 人生导师</div><div className="logo-sub">v3.1</div></div>
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

      {/* MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-left">
            <h1>📅 日历 &amp; 复盘</h1>
            <div className="subtitle">{new Date().toLocaleDateString("zh-CN", { weekday: "long" })}</div>
          </div>
          <div className="topbar-right" style={{ gap: 8 }}>
            <div className="month-nav">
              <button className="month-btn" onClick={prevMonth}>‹</button>
              <span className="month-label">{monthName}</span>
              <button className="month-btn" onClick={nextMonth}>›</button>
            </div>
            <button className="btn-ghost btn-sm"
              onClick={() => { setViewYear(new Date().getFullYear()); setViewMonth(new Date().getMonth()); }}>
              今天
            </button>
            <div className="view-switch">
              {(["month", "week", "year"] as ViewMode[]).map(v => (
                <button key={v} className={cn("view-btn", view === v && "active")}
                  onClick={() => setView(v)}>
                  {v === "month" ? "月" : v === "week" ? "周" : "年"}
                </button>
              ))}
            </div>
            <button className="btn-ghost btn-sm" onClick={() => router.push("/chat")}>
              🤖 AI 总结
            </button>
          </div>
        </div>

        {/* CONTENT */}
        <div className="content" style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>

          {/* Two-column */}
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>

            {/* ── LEFT: TODO POOL ── */}
            <div className="todo-panel">

              {/* progress carousel */}
              <ProgressCarousel todos={todos} reviews={reviews} />

              {/* add button */}
              <button className="todo-add-btn" onClick={() => setShowAddTodo(true)}>
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

              {/* in-progress */}
              {filter !== "done" && inProgress.length > 0 && (
                <div className="todo-section">
                  <div className="todo-section-label">⏳ 进行中</div>
                  {inProgress.map(todo => {
                    const ps = priStyle(todo.priority);
                    return (
                      <div key={todo.id} className="todo-item">
                        <button className="todo-check" onClick={() => handleToggleComplete(todo.id, true)}>
                          ○
                        </button>
                        <div className="todo-item-body">
                          <div className="todo-item-title">{todo.title}</div>
                          <div style={{ fontSize: 10, color: "var(--sb-text-muted)", marginTop: 2 }}>
                            {tagEmoji(todo.tag)} {tagLabel(todo.tag)}
                          </div>
                          <div style={{
                            display: "inline-block", marginTop: 4,
                            padding: "1px 6px", borderRadius: 4,
                            background: ps.bg, color: ps.color,
                            fontSize: 9, fontWeight: 600,
                          }}>
                            {priText(todo.priority)}
                          </div>
                        </div>
                        <button className="todo-delete" onClick={() => handleDeleteTodo(todo.id)}>🗑</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* done */}
              {filter !== "active" && donePool.length > 0 && (
                <div className="todo-section">
                  <div className="todo-section-label done">✓ 已完成 · 已归档到日历</div>
                  {donePool.map(todo => (
                    <div key={todo.id} className="todo-item done">
                      <button className="todo-check done" onClick={() => handleToggleComplete(todo.id, false)}>
                        ✓
                      </button>
                      <div className="todo-item-body">
                        <div className="todo-item-title done">{todo.title}</div>
                        <div style={{ fontSize: 9, color: "#16a34a", marginTop: 2 }}>
                          📍 {todo.completedAt?.slice(5, 10).replace("-", "/")} 已归档
                        </div>
                      </div>
                      <button className="todo-delete" onClick={() => handleDeleteTodo(todo.id)}>🗑</button>
                    </div>
                  ))}
                </div>
              )}

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
                  <div className="ai-suggestion-cta"
                    onClick={() => handleAddTodo(`${tagLabel(aiSuggestion.tag)} 30 分钟`, aiSuggestion.tag as Todo["tag"], "medium")}>
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
                      onClick={() => handleAddTodo(`${tagLabel(t.tag)} 30 分钟`, t.tag, t.priority)}>
                      {t.label}
                    </button>
                  ))}
                  <button className="template-chip" onClick={() => setShowAddTodo(true)}>+ 自定义</button>
                </div>
              </div>
            </div>

            {/* ── RIGHT: CALENDAR ── */}
            <div className="calendar-grid-panel">
              {/* weekday headers */}
              <div className="cal-weekdays">
                {weekdays.map((d, i) => (
                  <div key={d} className={cn("cal-weekday", (i === 5 || i === 6) && "weekend")}>{d}</div>
                ))}
              </div>

              {/* cells */}
              <div className="cal-cells">
                {monthDays.map((day, idx) => {
                  if (!day) return <div key={`e-${idx}`} className="cal-cell empty" />;

                  const { done, reviews: revs } = getCellItems(day);
                  const isToday = iso(day) === today_iso;
                  const isPast = iso(day) < today_iso;
                  const isFuture = iso(day) > today_iso;
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const allItems = [
                    ...done.map(t => ({ kind: "done" as const, text: t.title, id: t.id })),
                    ...revs.map(r => ({
                      kind: (r.type === "weekly" || r.type === "monthly" ? "ai" : "review") as "done" | "review" | "ai",
                      text: r.content.slice(0, 18),
                      id: r.id,
                    })),
                  ];

                  return (
                    <div key={iso(day)}
                      className={cn("cal-cell",
                        isToday && "today",
                        isWeekend && "weekend-cell",
                        isFuture && "future-cell",
                        !isToday && !isFuture && !isWeekend && "past-cell"
                      )}
                      onClick={() => setReviewDate(day)}>
                      <div className="cal-cell-header">
                        <span className={cn("cal-day-num", isToday && "today-num")}>{day.getDate()}</span>
                        {isToday && <span className="today-badge">TODAY</span>}
                      </div>
                      <div className="cal-cell-items">
                        {allItems.slice(0, 3).map(item => (
                          <div key={item.id}
                            className={cn("cal-item",
                              item.kind === "done" && "cal-item-done",
                              item.kind === "review" && "cal-item-review",
                              item.kind === "ai" && "cal-item-ai"
                            )}>
                            {item.kind === "done" ? "✓ " : item.kind === "review" ? "📝 " : "🤖 "}
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

      {/* MODALS */}
      {showAddTodo && (
        <AddTodoModal
          onAdd={handleAddTodo}
          onClose={() => setShowAddTodo(false)}
        />
      )}
      {reviewDate && (
        <AddReviewModal
          date={reviewDate}
          onAdd={handleAddReview}
          onClose={() => setReviewDate(null)}
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

        /* Progress Carousel */
        .progress-carousel { background: var(--sb-ink); border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
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
        .cal-weekday.weekend { color: #ec4899; }
        .cal-cells { display: grid; grid-template-columns: repeat(7, 1fr); }
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
        .modal-textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--sb-border); border-radius: 8px; font-size: 13px; font-family: inherit; outline: none; resize: vertical; min-height: 80px; box-sizing: border-box; }
        .modal-textarea:focus { border-color: var(--sb-primary); }
        .modal-row { display: flex; flex-direction: column; gap: 6px; }
        .modal-label { font-size: 11px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .tag-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .tag-chip { padding: 5px 10px; border-radius: 20px; border: 1.5px solid var(--sb-border); background: white; font-size: 11px; color: var(--sb-text-secondary); cursor: pointer; }
        .tag-chip.active { background: var(--sb-primary); color: #fff; border-color: var(--sb-primary); }
        .modal-submit { width: 100%; background: var(--sb-primary); color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .modal-submit:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
