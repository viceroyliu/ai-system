"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import {
  Send, Paperclip, Brain, Zap, Share2,
  Bot, User, Copy, RotateCcw, ArrowDownToLine, Target, FileText,
  MessageSquare, Loader2, X, Plus, ChevronDown, Sparkles, AtSign, MessageSquarePlus
} from "lucide-react";
import { apiClient, API_BASE, type NoteItem, type Todo, type Review } from "@/lib/api";
import type { SearchResult } from "@/lib/types";
import { useDataSources, saveChatSession, getChatSessions, getSessionMessages, saveSessionMessages, useActiveModel, type StoredMsg } from "@/lib/hooks";
import Sidebar from "@/components/Sidebar";
import Markdown from "@/components/Markdown";
import AiDualRing from "@/components/AiDualRing";

function buildId() { return Math.random().toString(36).slice(2, 10); }
function formatTime(d: Date) { return d.toTimeString().slice(0, 5); }

// 截断模型输出里的控制符（<turn|> 等）与退化乱码（连续单字母），再把 LaTeX 写法转成可读字符
function cleanLatex(text: string) {
  let t = text || "";
  const ctrl = t.search(/<turn\|?>|<\|im_end\|>|<\|endoftext\|>|<end_of_turn>|<\|eot_id\|>|<\|im_start\|>/);
  if (ctrl >= 0) t = t.slice(0, ctrl);
  const degen = t.search(/(?:\b[a-zA-Z]\b[\s,，]+){12,}/);
  if (degen >= 0) t = t.slice(0, degen);
  t = t.replace(/<\|[^>]*\|>/g, "");
  return t
    .replace(/\$\s*\\?(rightarrow|to)\s*\$/g, " → ")
    .replace(/\\(rightarrow|to)\b/g, "→")
    .replace(/\$\s*\\?(leftarrow|gets)\s*\$/g, " ← ")
    .replace(/\\times\b/g, "×")
    .replace(/\\?\$(.+?)\$/g, "$1");
}

type RefMode = "auto" | "only_refs" | "no_rag";
const REF_MODE_LABEL: Record<RefMode, string> = {
  auto: "自动检索",
  only_refs: "仅用引用",
  no_rag: "纯对话",
};
const REF_MODE_HINT: Record<RefMode, string> = {
  auto: "AI 自动从知识库找相关笔记，并优先使用你 @ 引用的笔记",
  only_refs: "AI 只看你 @ 引用的笔记，不额外检索",
  no_rag: "不引用任何笔记，纯模型对话",
};
const REF_MODE_ORDER: RefMode[] = ["auto", "only_refs", "no_rag"];

interface ChatMsg {
  id: string; role: "user" | "assistant"; content: string;
  timestamp: Date; sources?: SearchResult[]; model?: string;
  hidden?: boolean; label?: string; auto?: boolean;
}

interface SlashCommand {
  cmd: string; desc: string; template?: string; action?: "clear";
}
const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "复盘", desc: "根据最近目标和复盘，做一次复盘", template: "根据我最近的目标和复盘，帮我做一次复盘，并指出我现在最该反思的一点。" },
  { cmd: "目标", desc: "梳理进行中的目标并给建议", template: "梳理我当前进行中的目标，按优先级告诉我下一步该怎么推进。" },
  { cmd: "总结", desc: "总结已引用的笔记要点", template: "总结我已引用的这些笔记的核心要点。" },
  { cmd: "搜索", desc: "在知识库里搜索", template: "在我的知识库里搜索：" },
  { cmd: "清空", desc: "清空当前对话", action: "clear" },
];

const FALLBACK_SUGGESTIONS = ["本周复盘最该关注哪一点？", "我现在的目标里哪个最该先推进？", "我的学习方法有什么盲点？"];

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const qParam = searchParams.get("q");
  const insightParam = searchParams.get("insight");
  const autoParam = searchParams.get("auto");
  const [devMode, setDevMode] = useState(false);
  const [pendingAuto, setPendingAuto] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const { active, select } = useActiveModel();
  const currentModel = active.model;
  const [models, setModels] = useState<string[]>([]);
  const [onlineModels, setOnlineModels] = useState<string[]>([]);
  const [kbCount, setKbCount] = useState<number | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // @ 引用 / 上下文
  const [refs, setRefs] = useState<NoteItem[]>([]);
  const [refMode, setRefMode] = useState<RefMode>("auto");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [startedAt, setStartedAt] = useState("");

  // @ 与 / 菜单
  const [mention, setMention] = useState<{ open: boolean; query: string; start: number; index: number }>({ open: false, query: "", start: 0, index: 0 });
  const [slash, setSlash] = useState<{ open: boolean; query: string; index: number }>({ open: false, query: "", index: 0 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [textareaHeight, setTextareaHeight] = useState(48);
  const { activeIds } = useDataSources();

  useEffect(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = "auto"; setTextareaHeight(Math.min(el.scrollHeight, 200)); }
  }, [input]);

  // 持久化引用模式 + 温度；记录开始时间（仅客户端，避免水合不一致）
  useEffect(() => {
    setHydrated(true);
    setStartedAt(formatTime(new Date()));
    try {
      const m = localStorage.getItem("ai_chat_ref_mode") as RefMode | null; if (m && REF_MODE_ORDER.includes(m)) setRefMode(m);
      setDevMode(localStorage.getItem("ai_dev_mode") === "1");
    } catch {}
  }, []);
  function toggleDevMode() {
    setDevMode(v => { const next = !v; try { localStorage.setItem("ai_dev_mode", next ? "1" : "0"); } catch {} return next; });
  }
  useEffect(() => { try { localStorage.setItem("ai_chat_ref_mode", refMode); } catch {} }, [refMode]);

  // ── 动态生成空状态问题：基于进行中的目标 + 最近复盘 ──
  const generateAISuggestions = useCallback(async (todoItems: Todo[], reviewItems: Review[], model: string) => {
    const activeGoals = todoItems.filter(t => !t.completedAt).map(t => t.title).slice(0, 8);
    const latestReview = [...reviewItems].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    if (!activeGoals.length && !latestReview) { setSuggestions(FALLBACK_SUGGESTIONS); return; }
    const parts = [];
    if (activeGoals.length) parts.push(`进行中的目标：${activeGoals.join("、")}`);
    if (latestReview?.content) parts.push(`最近一次复盘（${latestReview.date}）：${latestReview.content.slice(0, 200)}`);
    const prompt =
      `你是用户的 AI 教练。基于他下面的近况，生成 3 个你想反问他、促使他反思的问题。\n` +
      `只输出 3 行，每行一个问题，中文，简洁（不超过 30 字），不要编号或多余文字。\n\n` +
      parts.join("\n");
    try {
      const resp = await apiClient.chat(prompt, model, undefined, true);
      const qs = resp.answer.split("\n").map(l => l.replace(/^[\d.、)\-\s]+/, "").trim())
        .filter(l => l.length > 4 && l.length < 40).slice(0, 3);
      setSuggestions(qs.length >= 2 ? qs : FALLBACK_SUGGESTIONS);
    } catch { setSuggestions(FALLBACK_SUGGESTIONS); }
  }, []);

  // ── 回答后生成"你可能想继续问"的追问 ──
  const generateFollowups = useCallback(async (question: string, answer: string) => {
    const prompt =
      `下面是一段对话。请基于它，生成 4 个用户可能想继续追问的简短问题。\n` +
      `只输出 4 行，每行一个问题，中文，不超过 18 字，不要编号。\n\n` +
      `问：${question.slice(0, 150)}\n答：${answer.slice(0, 400)}`;
    try {
      const resp = await apiClient.chat(prompt, currentModel, undefined, true, [], active.provider);
      const qs = resp.answer.split("\n").map(l => l.replace(/^[\d.、)\-\s→]+/, "").trim())
        .filter(l => l.length > 3 && l.length < 24).slice(0, 4);
      if (qs.length >= 2) setSuggestions(qs);
    } catch {}
  }, [currentModel, active.provider]);

  useEffect(() => {
    if (!hydrated) return;
    async function init() {
      try {
        const [m, s, n, t, r] = await Promise.all([
          apiClient.getModels(),
          apiClient.getStatus(),
          apiClient.getNotes(),
          apiClient.getTodos(),
          apiClient.getReviews(),
        ]);
        setModels(m.models || []);
        try { const cached = localStorage.getItem("aimira-online-models"); if (cached) setOnlineModels(JSON.parse(cached)); } catch {}
        setKbCount(s.documents);
        setNotes(n.notes || []);
        setTodos(t.todos || []);
        setReviews(r.reviews || []);
        generateAISuggestions(t.todos || [], r.reviews || [], m.current || "");
      } catch {}
    }
    init();
  }, [hydrated, generateAISuggestions]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── 会话加载：?session= 加载该会话；?q= 新会话并预填；否则加载最近一条（仅客户端）
  useEffect(() => {
    if (!hydrated) return;
    const toChatMsg = (s: StoredMsg): ChatMsg => ({
      id: s.id, role: s.role, content: s.content,
      timestamp: new Date(s.timestamp), sources: s.sources as SearchResult[] | undefined, model: s.model,
      hidden: s.hidden, label: s.label, auto: s.auto,
    });
    if (sessionParam) {
      setSessionId(sessionParam);
      setMessages(getSessionMessages(sessionParam).map(toChatMsg));
    } else if (insightParam) {
      // 从「今天想思考什么」继续：注入隐藏提示词 + 已生成的回答作为上下文
      let payload: { prompt?: string; name?: string; emoji?: string; answer?: string } | null = null;
      try { payload = JSON.parse(sessionStorage.getItem("ai_insight_continue") || "null"); } catch {}
      try { sessionStorage.removeItem("ai_insight_continue"); } catch {}
      setSessionId(buildId());
      if (payload?.prompt) {
        const now = new Date();
        setMessages([
          { id: buildId(), role: "user", content: payload.prompt, timestamp: now, hidden: true, label: `${payload.emoji || "💭"} ${payload.name || "洞察"}` },
          { id: buildId(), role: "assistant", content: payload.answer || "", timestamp: now },
        ]);
      } else {
        setMessages([]);
      }
    } else if (autoParam === "1") {
      // 从日历「AI 总结」进入：读取暂存的提示词并自动发送（可见消息）
      let text = "";
      try { text = sessionStorage.getItem("ai_chat_autosend") || ""; } catch {}
      try { sessionStorage.removeItem("ai_chat_autosend"); } catch {}
      setSessionId(buildId());
      setMessages([]);
      if (text) setPendingAuto(text);
    } else if (qParam) {
      setSessionId(buildId());
      setMessages([]);
      setInput(qParam);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } else {
      const latest = getChatSessions()[0];
      if (latest) { setSessionId(latest.id); setMessages(getSessionMessages(latest.id).map(toChatMsg)); }
      else setSessionId(buildId());
    }
  }, [hydrated, sessionParam, qParam, insightParam, autoParam]);

  // 自动发送（来自日历「AI 总结」）：只触发一次
  useEffect(() => {
    if (pendingAuto && !loading) {
      const t = pendingAuto;
      setPendingAuto("");
      handleSend(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAuto]);

  // ── 持久化当前会话（完整消息 + 元数据）──
  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    const firstUser = messages.find(m => m.role === "user");
    if (!firstUser) return;
    const lastMsg = messages[messages.length - 1];
    saveSessionMessages(sessionId, messages.map(m => ({
      id: m.id, role: m.role, content: m.content, timestamp: m.timestamp.toISOString(),
      sources: m.sources, model: m.model, hidden: m.hidden, label: m.label, auto: m.auto,
    })));
    saveChatSession({
      id: sessionId,
      title: (firstUser.hidden ? firstUser.label : firstUser.content)?.slice(0, 40) || "新对话",
      preview: lastMsg.content.slice(0, 80),
      updatedAt: lastMsg.timestamp.toISOString(),
    });
  }, [messages, sessionId]);

  function newConversation() {
    setInput("");
    setRefs([]);
    router.push(`/chat?session=${buildId()}`);
  }

  // ── 引用管理 ──
  function addRef(note: NoteItem) {
    setRefs(prev => prev.some(r => r.id === note.id) ? prev : [...prev, note]);
  }
  function removeRef(id: string) { setRefs(prev => prev.filter(r => r.id !== id)); }

  // ── @ / 命令 匹配 ──
  function mentionMatches(query: string): NoteItem[] {
    const q = query.trim().toLowerCase();
    const pool = notes.filter(n => n.title && n.title !== "无标题");
    if (!q) return pool.slice(0, 8);
    return pool.filter(n => n.title.toLowerCase().includes(q) || (n.tags || "").toLowerCase().includes(q)).slice(0, 8);
  }
  function slashMatches(query: string): SlashCommand[] {
    const q = query.trim();
    return q ? SLASH_COMMANDS.filter(c => c.cmd.includes(q)) : SLASH_COMMANDS;
  }

  // ── AI 推荐补充：基于「整段对话内容 + 已引用笔记」，从笔记/目标库里找相关的 ──
  const recs: NoteItem[] = (() => {
    const refIds = new Set(refs.map(r => r.id));
    const pool = notes.filter(n => n.title && n.title !== "无标题" && !refIds.has(n.id));
    // 对话语料：全部消息正文 + 已引用笔记标题/标签
    const convoText = (
      messages.map(m => m.content).join(" ") + " " +
      refs.map(r => `${r.title} ${r.tags || ""}`).join(" ")
    ).toLowerCase().trim();
    if (!convoText) return pool.slice(0, 3);
    const refTags = new Set(refs.flatMap(r => (r.tags || "").split(/[,，、]/).map(s => s.trim()).filter(Boolean)));
    const scored = pool.map(n => {
      let score = 0;
      const title = n.title || "";
      // 中文用 2-gram 粗匹配：标题里出现在对话语料中的片段计分
      const grams = new Set<string>();
      for (let i = 0; i < title.length - 1; i++) grams.add(title.slice(i, i + 2).toLowerCase());
      for (const g of grams) if (g.trim().length === 2 && convoText.includes(g)) score += 1;
      const tags = (n.tags || "").split(/[,，、]/).map(s => s.trim());
      if (tags.some(t => t && refTags.has(t))) score += 3;
      if (tags.some(t => t && convoText.includes(t.toLowerCase()))) score += 2;
      if (n.database === "目标") score += 0.5; // 目标类内容略微优先，便于参考推进
      return { n, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).map(x => x.n);
    return top.length ? top : pool.slice(0, 3);
  })();

  function onInputChange(value: string) {
    setInput(value);
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : value.length;
    // 斜杠命令：输入以 / 开头且尚未出现空格
    const slashMatch = /^\/(\S*)$/.exec(value);
    if (slashMatch) {
      setSlash({ open: true, query: slashMatch[1], index: 0 });
      setMention(m => ({ ...m, open: false }));
      return;
    } else if (slash.open) {
      setSlash(s => ({ ...s, open: false }));
    }
    // @ 引用：光标前最近的 @，且 @ 在开头或前面是空白
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at >= 0) {
      const before = at === 0 ? "" : upto[at - 1];
      const token = upto.slice(at + 1);
      if ((at === 0 || /\s/.test(before)) && !/\s/.test(token) && !token.includes("「")) {
        setMention({ open: true, query: token, start: at, index: 0 });
        return;
      }
    }
    if (mention.open) setMention(m => ({ ...m, open: false }));
  }

  function pickMention(note: NoteItem) {
    const end = mention.start + 1 + mention.query.length;
    const next = input.slice(0, mention.start) + `@「${note.title}」 ` + input.slice(end);
    setInput(next);
    addRef(note);
    setMention(m => ({ ...m, open: false }));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function runSlash(cmd: SlashCommand) {
    setSlash(s => ({ ...s, open: false }));
    if (cmd.action === "clear") { setMessages([]); setInput(""); return; }
    if (cmd.template) { setInput(cmd.template); requestAnimationFrame(() => { const el = textareaRef.current; el?.focus(); if (el) { el.selectionStart = el.selectionEnd = cmd.template!.length; } }); }
  }

  async function handleSend(textOverride?: string) {
    const q = (textOverride ?? input).trim();
    if (!q || loading) return;
    const userMsg: ChatMsg = { id: buildId(), role: "user", content: q, timestamp: new Date() };
    const aiId = buildId();
    setMessages(prev => [...prev, userMsg, { id: aiId, role: "assistant", content: "", timestamp: new Date(), sources: [], model: currentModel, auto: refMode === "auto" }]);
    setInput("");
    setLoading(true);
    setSuggestions([]);

    const no_rag = refMode === "no_rag" || refMode === "only_refs";
    const refIds = refMode === "no_rag" ? [] : refs.map(r => r.id);
    const sources = refMode === "auto" ? activeIds : undefined;

    const patchAi = (fn: (m: ChatMsg) => ChatMsg) => setMessages(prev => prev.map(m => m.id === aiId ? fn(m) : m));

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, model: currentModel, provider: active.provider, sources, no_rag, ref_note_ids: refIds }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let evt: { type: string; text?: string; sources?: SearchResult[] };
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === "sources") patchAi(m => ({ ...m, sources: evt.sources || [] }));
          else if (evt.type === "delta") { full += evt.text || ""; patchAi(m => ({ ...m, content: full })); }
          else if (evt.type === "error") { full += evt.text || ""; patchAi(m => ({ ...m, content: full })); }
        }
      }
      if (!full.trim()) {
        const svc = active.provider === "online" ? "线上 API（设置中检查地址/Key/模型名）" : "本地 LM Studio（确认已加载模型）";
        patchAi(m => ({ ...m, content: `（模型没有返回内容，请检查${svc}）` }));
      }
      generateFollowups(q, full);
    } catch (e: unknown) {
      const svc = active.provider === "online" ? "线上 API 是否可访问、Key 是否正确" : "本地 LM Studio 是否已加载模型";
      patchAi(m => ({ ...m, content: `请求失败: ${e instanceof Error ? e.message : String(e)}。请确认${svc}。` }));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.open) {
      const list = mentionMatches(mention.query);
      if (e.key === "ArrowDown") { e.preventDefault(); setMention(m => ({ ...m, index: Math.min(m.index + 1, list.length - 1) })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMention(m => ({ ...m, index: Math.max(m.index - 1, 0) })); return; }
      if (e.key === "Enter") { if (list[mention.index]) { e.preventDefault(); pickMention(list[mention.index]); return; } }
      if (e.key === "Escape") { e.preventDefault(); setMention(m => ({ ...m, open: false })); return; }
    }
    if (slash.open) {
      const list = slashMatches(slash.query);
      if (e.key === "ArrowDown") { e.preventDefault(); setSlash(s => ({ ...s, index: Math.min(s.index + 1, list.length - 1) })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlash(s => ({ ...s, index: Math.max(s.index - 1, 0) })); return; }
      if (e.key === "Enter") { if (list[slash.index]) { e.preventDefault(); runSlash(list[slash.index]); return; } }
      if (e.key === "Escape") { e.preventDefault(); setSlash(s => ({ ...s, open: false })); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function cycleRefMode() {
    setRefMode(prev => REF_MODE_ORDER[(REF_MODE_ORDER.indexOf(prev) + 1) % REF_MODE_ORDER.length]);
  }

  function pickModel(m: string, provider: "local" | "online") {
    setModelMenuOpen(false);
    if (m === currentModel) return;
    select(m, provider);
  }

  function startWithGoal(title: string) {
    setInput(`我想推进「${title}」，给我具体的下一步建议。`);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const activeGoals = todos.filter(t => !t.completedAt).slice(0, 4);
  const mList = mentionMatches(mention.query);
  const sList = slashMatches(slash.query);
  const lastAiSources = [...messages].reverse().find(m => m.role === "assistant")?.sources?.length || 0;
  const citedCount = refs.length || lastAiSources;

  return (
    <div className="app-layout">
      <Sidebar activePage="chat" />

      <main className="chat-main">
        <div className="chat-topbar">
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand-50)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MessageSquare size={14} style={{ color: "var(--brand-500)" }} />
          </div>
          <div className="chat-title-wrap">
            <div className="chat-title">
              {(() => { const fu = messages.find(m => m.role === "user"); return (fu?.hidden ? fu.label : fu?.content)?.slice(0, 30) || "新对话"; })()}
            </div>
            <div className="chat-meta">{messages.length} 条消息 · 引用 {citedCount} 篇笔记{hydrated && startedAt ? ` · ${startedAt} 开始` : ""}</div>
          </div>
          <button className={`btn-light${devMode ? " dev-on" : ""}`} style={{ padding: "8px 13px" }} onClick={toggleDevMode} title="开发模式：显示被隐藏的洞察提示词">
            <Brain size={12} /> 开发{devMode ? " ·开" : ""}
          </button>
          <button className="btn-light" style={{ padding: "8px 13px" }} onClick={newConversation}>
            <MessageSquarePlus size={12} /> 新对话
          </button>
          <button className="btn-light" style={{ padding: "8px 13px" }}>
            <Share2 size={12} /> 分享
          </button>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: 40 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, var(--brand-200), var(--brand-500))", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <Bot size={28} style={{ color: "white" }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--sb-ink)", marginBottom: 8 }}>你好，我是 Aimira</div>
              <div style={{ fontSize: 12, color: "var(--sb-text-muted)", marginBottom: 20 }}>基于你的 {kbCount ?? "—"} 条笔记和向量数据库回答</div>

              {hydrated && suggestions.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: "var(--sb-text-muted)", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <Sparkles size={11} style={{ color: "var(--brand-500)" }} /> 基于你的目标和复盘，我想先问你：
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520, margin: "0 auto" }}>
                    {suggestions.map(s => (
                      <button key={s} onClick={() => handleSend(s)}
                        style={{ background: "var(--brand-50)", border: "1px solid var(--brand-200)", borderRadius: 9999, padding: "6px 14px", fontSize: 12, color: "var(--brand-700)", cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {activeGoals.length > 0 && (
                <div style={{ background: "var(--brand-bg2)", borderRadius: 14, padding: 16, maxWidth: 520, margin: "20px auto 0", textAlign: "left" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6d28d9", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                    <Target size={10} /> 继续推进你的目标
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {activeGoals.map(g => (
                      <button key={g.id} onClick={() => startWithGoal(g.title)}
                        style={{ background: "#fff", border: "1px solid var(--brand-bgborder)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "var(--brand-900)", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                        <Target size={10} /> {g.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {messages.map((msg, mi) => {
            const isLastAi = msg.role === "assistant" && mi === messages.length - 1;
            return (
            <div key={msg.id} className={`chat-msg ${msg.role}`}>
              <div className={`msg-avatar ${msg.role === "user" ? "user" : "ai"}`}>
                {msg.role === "user" ? <User size={12} /> : <Bot size={12} />}
              </div>
              <div className={`msg-content ${msg.role === "assistant" ? "ai-card" : "user-bubble"}`}>
                <div className="msg-head">
                  <span className="msg-role">{msg.role === "user" ? "You" : "Aimira"}</span>
                  <span className="msg-time">{formatTime(msg.timestamp)}{msg.model ? ` · ${msg.model}` : ""}</span>
                  {msg.role === "user" && msg.hidden && !devMode && (
                    <span className="hidden-prompt-tag">提示词已隐藏</span>
                  )}
                </div>
                <div className="msg-text">
                  {msg.role === "assistant"
                    ? (msg.content
                        ? <>{<Markdown>{cleanLatex(msg.content)}</Markdown>}{isLastAi && loading && <span className="stream-cursor">▍</span>}</>
                        : <span className="thinking-dots"><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> 思考中…</span>)
                    : (msg.hidden && !devMode ? <span className="hidden-prompt-label">{msg.label || "（已隐藏的提示词）"}</span> : msg.content)}
                </div>

                {msg.role === "assistant" && msg.content && !(isLastAi && loading) && (
                  <div className="msg-actions">
                    <button className="act-dark"><ArrowDownToLine size={11} /> 存入 AI 笔记</button>
                    <button className="act-ghost" onClick={() => { setInput(messages.find(m => m.role === "user" && messages.indexOf(m) === mi - 1)?.content || input); }}><RotateCcw size={11} /> 重新生成</button>
                    <button className="act-ghost" onClick={() => navigator.clipboard?.writeText(msg.content)}><Copy size={11} /> 复制</button>
                  </div>
                )}

                {msg.role === "assistant" && !(isLastAi && loading) && (
                  <div className="sources-section">
                    <div className="sources-title"><Paperclip size={9} /> {msg.sources && msg.sources.length > 0 ? `${msg.auto ? "自动引用了" : "引用了"} ${msg.sources.length} 个来源` : (msg.auto ? "自动检索未找到相关笔记（引用 0）" : "本次未引用笔记（引用 0）")}</div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="source-grid">
                        {msg.sources.slice(0, 12).map((src, i) => (
                          <span key={i} className="source-chip"><FileText size={9} /> {src.title || "无标题"}</span>
                        ))}
                        {msg.sources.length > 12 && <span className="source-chip more">+ {msg.sources.length - 12} more</span>}
                      </div>
                    )}
                  </div>
                )}

                {isLastAi && hydrated && suggestions.length > 0 && (
                  <div className="followups">
                    <div className="followups-title"><Sparkles size={11} /> 你可能想继续问：</div>
                    <div className="followup-chips">
                      {suggestions.map(s => (
                        <button key={s} className="followup-chip" onClick={() => handleSend(s)}>→ {s}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );})}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-area" style={{ position: "relative" }}>
          {/* @ 引用菜单 */}
          {mention.open && mList.length > 0 && (
            <div className="mention-menu">
              <div className="menu-head"><AtSign size={10} /> 引用笔记</div>
              {mList.map((n, i) => (
                <div key={n.id} className={`menu-item ${i === mention.index ? "active" : ""}`}
                  onMouseEnter={() => setMention(m => ({ ...m, index: i }))}
                  onMouseDown={e => { e.preventDefault(); pickMention(n); }}>
                  <FileText size={11} style={{ color: "var(--brand-500)", flexShrink: 0 }} />
                  <span className="menu-item-title">{n.title}</span>
                  <span className="menu-item-meta">{n.database || "笔记"}</span>
                </div>
              ))}
            </div>
          )}
          {/* / 命令菜单 */}
          {slash.open && sList.length > 0 && (
            <div className="mention-menu">
              <div className="menu-head"><Zap size={10} /> 命令</div>
              {sList.map((c, i) => (
                <div key={c.cmd} className={`menu-item ${i === slash.index ? "active" : ""}`}
                  onMouseEnter={() => setSlash(s => ({ ...s, index: i }))}
                  onMouseDown={e => { e.preventDefault(); runSlash(c); }}>
                  <span style={{ color: "var(--brand-500)", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>/{c.cmd}</span>
                  <span className="menu-item-meta" style={{ marginLeft: "auto" }}>{c.desc}</span>
                </div>
              ))}
            </div>
          )}

          <div className="chat-input-wrap">
            {refs.length > 0 && (
              <div className="ref-bar">
                {refs.map(r => (
                  <span key={r.id} className="ref-chip">
                    <FileText size={9} /> {r.title.slice(0, 16)}
                    <button onClick={() => removeRef(r.id)} className="ref-chip-x"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
            <textarea ref={textareaRef} className="chat-input" placeholder="问点什么…（输入 @ 引用笔记，/ 调用命令）"
              value={input} onChange={e => onInputChange(e.target.value)} onKeyDown={handleKeyDown} rows={1}
              style={{ height: `${textareaHeight}px` }} />
            <div className="chat-input-toolbar">
              <button className="chat-tool-btn" style={{ display: "flex", alignItems: "center", gap: 4 }}
                onMouseDown={e => {
                  e.preventDefault();
                  const next = (input && !input.endsWith(" ") ? input + " " : input) + "@";
                  setInput(next);
                  setSlash(s => ({ ...s, open: false }));
                  setMention({ open: true, query: "", start: next.length - 1, index: 0 });
                  requestAnimationFrame(() => { const el = textareaRef.current; el?.focus(); if (el) el.selectionStart = el.selectionEnd = next.length; });
                }}>
                <AtSign size={12} /> 引用
              </button>
              <button className="chat-tool-btn" style={{ display: "flex", alignItems: "center", gap: 4 }}
                onMouseDown={e => {
                  e.preventDefault();
                  setInput("/");
                  setMention(m => ({ ...m, open: false }));
                  setSlash({ open: true, query: "", index: 0 });
                  requestAnimationFrame(() => { const el = textareaRef.current; el?.focus(); if (el) el.selectionStart = el.selectionEnd = 1; });
                }}>
                <Zap size={12} /> 命令
              </button>
              <button className="chat-tool-btn" style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={cycleRefMode} title={REF_MODE_HINT[refMode]}>
                <Brain size={12} /> {REF_MODE_LABEL[refMode]}
              </button>
              {/* 索引提示紧贴模式按钮：自动检索→显示已索引数；仅用引用→显示已引用条数 */}
              <span style={{ fontSize: 10, color: "var(--sb-text-muted)" }}>
                {refMode === "auto" ? `${kbCount ?? "—"} 笔记已索引` : refMode === "only_refs" ? `引用了 ${refs.length} 条` : ""}
              </span>
              {/* 仅用引用模式下，右侧再提示总共已索引多少条 */}
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--sb-text-muted)" }}>
                {refMode === "only_refs" ? `已索引 ${kbCount ?? "—"} 条` : ""}
              </span>
              <button className="chat-send-btn" onClick={() => handleSend()}
                disabled={!input.trim() || loading} title="发送">
                {loading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Right Context Panel */}
      <aside className="context-panel">
        <div className="context-header">
          <div className="context-header-row">
            <div className="context-title"><Target size={14} /> Context 上下文</div>
            <span className="ctx-auto-badge"><span className="dot green" /> {refMode === "auto" ? "Auto" : refMode === "only_refs" ? "Refs" : "Off"}</span>
          </div>
          <div className="context-subtitle">{REF_MODE_HINT[refMode]}</div>
        </div>

        {/* KNOWLEDGE BASE: 对话上下文（深色卡） */}
        <div className="context-section">
          <div className="context-section-label"><Brain size={10} className="cs-ic" />KNOWLEDGE BASE</div>
          <div className="ctx-kb-card">
            <div className="ctx-kb-title">{refs.length > 0 ? `已引用 ${refs.length} 篇笔记` : "知识库自动检索"}</div>
            <div className="ctx-kb-meta">{refs.length > 0 ? "你手动选择的笔记" : `${kbCount ?? "—"} 篇笔记 · 按问题相关度加载`}</div>
            <div className="ctx-kb-inject"><span className="dot green" /> {refMode === "no_rag" ? "未启用引用" : "已注入对话"}</div>
            {refs.length > 0 && (
              <div className="ctx-ref-chips">
                {refs.map(n => (
                  <span key={n.id} className="ctx-ref-chip">{n.title.slice(0, 14)}
                    <button onClick={() => removeRef(n.id)}><X size={9} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI 推荐补充（紫色卡）：自动检索模式下不做手动推荐，直接显示「AI 自动检索中」 */}
        {refMode === "auto" ? (
          <div className="context-section">
            <div className="context-section-label"><Bot size={10} className="cs-ic" />AI 推荐补充</div>
            <div className="ctx-rec-card">
              <div className="ctx-rec-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <AiDualRing size={14} /> AI 自动检索
              </div>
              <div className="ctx-kb-meta" style={{ marginTop: 6 }}>已开启自动检索，AI 会按问题相关度自动从知识库匹配笔记，无需手动补充。</div>
            </div>
          </div>
        ) : hydrated && recs.length > 0 ? (
          <div className="context-section">
            <div className="context-section-label"><Bot size={10} className="cs-ic" />AI 推荐补充</div>
            <div className="ctx-rec-card">
              <div className="ctx-rec-title">{messages.length > 0 ? "根据当前对话，建议参考：" : refs.length > 0 ? "结合已引用内容，还可参考：" : "这个话题还可以参考："}</div>
              <ul className="ctx-rec-list">
                {recs.map(n => (
                  <li key={n.id}>
                    <span>{n.title}</span>
                    <button onClick={() => addRef(n)} title="加入对话"><Plus size={11} /></button>
                  </li>
                ))}
              </ul>
              <button className="ctx-rec-add-all" onClick={() => recs.forEach(addRef)}><Plus size={11} /> 加入对话</button>
            </div>
          </div>
        ) : null}

        {/* SETTINGS */}
        <div className="context-section">
          <div className="context-section-label"><MessageSquare size={10} className="cs-ic" />SETTINGS</div>
          <div className="setting-row" onClick={cycleRefMode} style={{ cursor: "pointer" }} title="点击切换：自动检索 / 仅用引用 / 纯对话">
            <span>引用模式</span><span className="setting-val" style={{ color: "var(--brand-500)" }}>{REF_MODE_LABEL[refMode]} ⇄</span>
          </div>
          <div className="setting-row" onClick={() => setModelMenuOpen(o => !o)} style={{ cursor: "pointer", position: "relative" }}>
            <span>当前模型</span>
            <span className="setting-val" style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 3 }}>{(currentModel || "—").slice(0, 16)} <ChevronDown size={11} /></span>
            {modelMenuOpen && (models.length > 0 || onlineModels.length > 0) && (
              <div className="model-menu">
                {[{ label: "本地", provider: "local" as const, list: models }, { label: "线上", provider: "online" as const, list: onlineModels }].map(g => (
                  g.list.length > 0 ? (
                    <div key={g.label}>
                      <div className="model-menu-group">{g.label}</div>
                      {g.list.map(m => (
                        <div key={`${g.provider}-${m}`} className={`model-menu-item ${m === currentModel ? "active" : ""}`} onClick={e => { e.stopPropagation(); pickModel(m, g.provider); }}>{m}</div>
                      ))}
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </div>
        </div>

      </aside>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .mention-menu {
          position: absolute; left: 24px; right: 24px; bottom: calc(100% - 8px);
          background: var(--sb-surface); border: 1px solid var(--sb-border);
          border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          max-height: 280px; overflow-y: auto; z-index: 50; padding: 6px;
        }
        .menu-head { font-size: 10px; font-weight: 700; color: var(--sb-text-muted); padding: 4px 8px 6px; display: flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
        .menu-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 8px; cursor: pointer; font-size: 12px; color: var(--sb-text); }
        .menu-item.active { background: var(--brand-50); }
        .menu-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .menu-item-meta { font-size: 10px; color: var(--sb-text-muted); flex-shrink: 0; }
        .ref-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
        .ref-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--brand-50); border: 1px solid var(--brand-200); color: var(--brand-700); border-radius: 9999px; padding: 3px 6px 3px 9px; font-size: 11px; }
        .ref-chip-x { border: none; background: transparent; cursor: pointer; color: var(--brand-500); display: flex; align-items: center; padding: 0; margin-left: 2px; }
        .ref-chip-x:hover { color: #ef4444; }
        .model-menu { position: absolute; top: 100%; right: 0; margin-top: 6px; background: var(--sb-surface); border: 1px solid var(--sb-border); border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.12); z-index: 60; min-width: 180px; max-height: 220px; overflow-y: auto; padding: 5px; }
        .model-menu-item { font-size: 11px; padding: 7px 9px; border-radius: 7px; cursor: pointer; color: var(--sb-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .model-menu-item:hover { background: var(--sb-muted); }
        .model-menu-item.active { background: var(--brand-50); color: var(--brand-700); font-weight: 600; }
        .model-menu-group { font-size: 9px; font-weight: 700; color: var(--sb-text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 9px 3px; }

        /* ===== messages ===== */
        .chat-msg { border-bottom: none; padding: 10px 0; align-items: flex-start; }
        .chat-msg.user { flex-direction: row-reverse; }
        .chat-msg.user .msg-head { flex-direction: row-reverse; }
        .chat-msg.user .msg-actions { justify-content: flex-end; }
        .msg-content.user-bubble { background: var(--sb-muted); border: 1px solid var(--sb-border); border-radius: 12px; padding: 11px 14px; }
        .msg-content.ai-card { background: #fff; border: 1px solid var(--sb-border); border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(15,23,42,0.04); }
        .msg-head { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
        .msg-time { font-size: 10px; color: var(--sb-text-muted); }
        .loaded-chip { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; background: var(--brand-50); color: var(--brand-700); border-radius: 9999px; padding: 2px 9px; font-size: 10px; font-weight: 600; }
        .msg-text { font-size: 13.5px; line-height: 1.7; color: var(--sb-text); word-break: break-word; }
        .msg-content.user-bubble .msg-text { white-space: pre-wrap; }
        .md-h { font-weight: 800; color: var(--sb-ink); margin: 14px 0 6px; }
        .md-h:first-child { margin-top: 0; }
        .md-p { margin: 0 0 8px; line-height: 1.75; }
        .md-p:last-child { margin-bottom: 0; }
        .md-ul, .md-ol { margin: 4px 0 10px; padding-left: 20px; }
        .md-ul { list-style: disc; } .md-ol { list-style: decimal; }
        .md-ul li, .md-ol li { margin-bottom: 4px; line-height: 1.6; }
        .md-code { background: var(--sb-muted); padding: 1px 5px; border-radius: 4px; font-size: 0.88em; font-family: ui-monospace, monospace; }
        .msg-text strong { font-weight: 700; color: var(--sb-ink); }
        .thinking-dots { display: inline-flex; align-items: center; gap: 6px; color: var(--sb-text-muted); font-size: 13px; }
        .stream-cursor { display: inline-block; margin-left: 1px; color: var(--sb-primary); animation: blink 1s step-start infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .msg-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
        .act-primary { display: inline-flex; align-items: center; gap: 5px; background: var(--sb-primary); color: #fff; border: none; border-radius: 9px; padding: 8px 13px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .act-primary:hover { background: var(--brand-600); }
        .act-dark { display: inline-flex; align-items: center; gap: 5px; background: var(--sb-ink); color: #fff; border: none; border-radius: 9px; padding: 8px 13px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .act-dark:hover { background: #1e293b; }
        .act-ghost { display: inline-flex; align-items: center; gap: 5px; background: #fff; color: var(--sb-text-secondary); border: 1px solid var(--sb-border); border-radius: 9px; padding: 8px 13px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; }
        .act-ghost:hover { background: var(--sb-muted); }
        .sources-section { margin-top: 14px; }
        .sources-title { font-size: 11px; color: var(--sb-text-muted); display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
        .source-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .source-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; background: var(--sb-muted); border-radius: 8px; padding: 6px 10px; font-size: 11px; color: var(--sb-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .source-chip.more { color: var(--sb-primary); }
        .hidden-prompt-tag { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; background: var(--sb-muted); color: var(--sb-text-muted); border-radius: 9999px; padding: 2px 9px; font-size: 10px; font-weight: 600; }
        .hidden-prompt-label { display: inline-flex; align-items: center; gap: 6px; color: var(--sb-text-secondary); font-style: italic; }
        .btn-light.dev-on { background: var(--brand-50); border-color: var(--brand-200); color: var(--brand-700); }

        /* ===== followups ===== */
        .followups { margin-top: 16px; }
        .followups-title { font-size: 11px; color: var(--sb-text-muted); display: flex; align-items: center; gap: 5px; margin-bottom: 8px; }
        .followup-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .followup-chip { background: var(--brand-50); border: 1px solid var(--brand-200); color: var(--brand-700); border-radius: 9999px; padding: 7px 14px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .followup-chip:hover { background: var(--brand-100); }

        /* ===== right panel ===== */
        .context-header-row { display: flex; align-items: center; justify-content: space-between; }
        .context-title { display: flex; align-items: center; gap: 6px; }
        .context-subtitle { font-size: 10.5px; color: var(--sb-text-muted); margin-top: 6px; line-height: 1.5; }
        .ctx-auto-badge { display: inline-flex; align-items: center; gap: 4px; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; border-radius: 9999px; padding: 2px 9px; font-size: 10px; font-weight: 600; }
        .cs-ic { display: inline; vertical-align: middle; margin-right: 3px; }
        .ctx-kb-card { background: var(--sb-ink); border-radius: 12px; padding: 13px 14px; }
        .ctx-kb-title { font-size: 13px; font-weight: 700; color: #fff; }
        .ctx-kb-meta { font-size: 10.5px; color: #94a3b8; margin: 5px 0 9px; }
        .ctx-kb-inject { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: #6ee7b7; }
        .ctx-ref-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
        .ctx-ref-chip { display: inline-flex; align-items: center; gap: 3px; background: rgba(255,255,255,0.08); color: #e2e8f0; border-radius: 6px; padding: 3px 5px 3px 8px; font-size: 10px; }
        .ctx-ref-chip button { border: none; background: transparent; color: #94a3b8; cursor: pointer; padding: 0; display: flex; }
        .ctx-ref-chip button:hover { color: #f87171; }
        .ctx-rec-card { background: linear-gradient(160deg,var(--brand-bg1),var(--brand-bg2)); border: 1px solid var(--brand-bgborder); border-radius: 12px; padding: 13px 14px; }
        .ctx-rec-title { font-size: 12px; font-weight: 700; color: #6d28d9; margin-bottom: 9px; }
        .ctx-rec-list { list-style: none; display: flex; flex-direction: column; gap: 7px; margin-bottom: 11px; }
        .ctx-rec-list li { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--brand-900); }
        .ctx-rec-list li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ctx-rec-list li::before { content: "·"; color: #8b5cf6; font-weight: 700; }
        .ctx-rec-list li button { border: none; background: #fff; color: #6d28d9; border-radius: 6px; cursor: pointer; display: flex; padding: 3px; flex-shrink: 0; }
        .ctx-rec-add-all { width: 100%; display: flex; align-items: center; justify-content: center; gap: 5px; background: #6d28d9; color: #fff; border: none; border-radius: 8px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .ctx-rec-add-all:hover { background: var(--brand-900); }
        .ctx-page-item { display: flex; align-items: center; gap: 9px; padding: 8px 6px; border-radius: 8px; }
        .ctx-page-item:hover { background: var(--sb-muted); }
        .ctx-page-icon { width: 26px; height: 26px; border-radius: 7px; background: #eff6ff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ctx-page-body { min-width: 0; flex: 1; }
        .ctx-page-name { font-size: 12px; font-weight: 600; color: var(--sb-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ctx-page-time { font-size: 10px; color: var(--sb-text-muted); margin-top: 1px; }
        .temp-slider { width: 100%; accent-color: var(--sb-primary); cursor: pointer; }
        .ctx-sync-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 13px 14px; }
        .ctx-sync-title { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: #15803d; margin-bottom: 9px; }
        .ctx-sync-list { list-style: none; display: flex; flex-direction: column; gap: 6px; margin-bottom: 11px; }
        .ctx-sync-list li { font-size: 11px; color: #166534; padding-left: 12px; position: relative; }
        .ctx-sync-list li::before { content: "•"; position: absolute; left: 0; color: #16a34a; }
        .ctx-sync-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 5px; background: #fff; border: 1px solid #bbf7d0; color: #15803d; border-radius: 8px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .ctx-sync-btn:hover { background: #dcfce7; }
      `}</style>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="app-layout"><div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: "var(--brand-500)" }} /></div></div>}>
      <ChatContent />
    </Suspense>
  );
}
