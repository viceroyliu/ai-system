"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { apiClient } from "./api";

// ─── Active model (shared across Sidebar & Chat) ──────────────
export type ModelProvider = "local" | "online";
export interface ActiveModel { model: string; provider: ModelProvider }
const MODEL_EVENT = "aimira-active-model";

export function useActiveModel() {
  const [active, setActive] = useState<ActiveModel>({ model: "", provider: "local" });

  useEffect(() => {
    let alive = true;
    apiClient.getModels()
      .then(m => { if (alive) setActive({ model: m.current || "", provider: m.provider || "local" }); })
      .catch(() => {});
    function onChange(e: Event) {
      const detail = (e as CustomEvent<ActiveModel>).detail;
      if (detail) setActive(detail);
    }
    window.addEventListener(MODEL_EVENT, onChange);
    return () => { alive = false; window.removeEventListener(MODEL_EVENT, onChange); };
  }, []);

  const select = useCallback((model: string, provider: ModelProvider) => {
    setActive({ model, provider });
    window.dispatchEvent(new CustomEvent<ActiveModel>(MODEL_EVENT, { detail: { model, provider } }));
    apiClient.setModel(model, provider).catch(() => {});
  }, []);

  return { active, select };
}

// ─── Data Sources ─────────────────────────────────────────────
export interface DataSource {
  id: string;
  name: string;
  type: "notion" | "local" | "custom";
  path?: string;
  active: boolean;
}

const DS_KEY = "aimira-data-sources";
const DS_DEFAULTS: DataSource[] = [
  { id: "notion", name: "Notion", type: "notion", active: true },
  { id: "local", name: "本地笔记", type: "local", active: true },
];

function loadSources(): DataSource[] {
  if (typeof window === "undefined") return DS_DEFAULTS;
  try {
    const raw = localStorage.getItem(DS_KEY);
    return raw ? JSON.parse(raw) : DS_DEFAULTS;
  } catch { return DS_DEFAULTS; }
}

export function useDataSources() {
  // 初始值必须与 SSR 一致；localStorage 仅在 mount 后读取，避免水合不匹配
  const [sources, setSources] = useState<DataSource[]>(DS_DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSources(loadSources());
    setReady(true);
  }, []);

  function toggle(id: string) {
    setSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, active: !s.active } : s);
      localStorage.setItem(DS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function addSource(src: Omit<DataSource, "active">) {
    setSources(prev => {
      const next = [...prev, { ...src, active: true }];
      localStorage.setItem(DS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function removeSource(id: string) {
    setSources(prev => {
      const next = prev.filter(s => s.id !== id);
      localStorage.setItem(DS_KEY, JSON.stringify(next));
      return next;
    });
  }

  const activeIds = sources.filter(s => s.active).map(s => s.id);
  return { sources, toggle, addSource, removeSource, activeIds, ready };
}

// ─── Chat History ─────────────────────────────────────────────
export interface ChatSession {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
}

const CH_KEY = "aimira-chat-sessions";

export function getChatSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CH_KEY) || "[]");
  } catch { return []; }
}

export function saveChatSession(session: ChatSession) {
  const existing = getChatSessions();
  const idx = existing.findIndex(s => s.id === session.id);
  if (idx >= 0) existing[idx] = session;
  else existing.unshift(session);
  existing.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  localStorage.setItem(CH_KEY, JSON.stringify(existing.slice(0, 100)));
}

export function deleteChatSession(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CH_KEY, JSON.stringify(getChatSessions().filter(s => s.id !== id)));
  try { localStorage.removeItem(MSG_PREFIX + id); } catch {}
}

// ─── Per-session messages ─────────────────────────────────────
export interface StoredSource { title?: string; database?: string; source?: string; page_id?: string }
export interface StoredMsg {
  id: string; role: "user" | "assistant"; content: string;
  timestamp: string; sources?: StoredSource[]; model?: string;
  hidden?: boolean; label?: string; auto?: boolean;
}
const MSG_PREFIX = "aimira-chat-msgs-";

export function getSessionMessages(id: string): StoredMsg[] {
  if (typeof window === "undefined" || !id) return [];
  try { return JSON.parse(localStorage.getItem(MSG_PREFIX + id) || "[]"); } catch { return []; }
}

export function saveSessionMessages(id: string, msgs: StoredMsg[]) {
  if (typeof window === "undefined" || !id) return;
  const slim = msgs.map(m => ({
    ...m,
    sources: m.sources?.map(s => ({ title: s.title, database: s.database, source: s.source, page_id: s.page_id })),
  }));
  try { localStorage.setItem(MSG_PREFIX + id, JSON.stringify(slim)); } catch {}
}

export function useChatHistory(query: string): ChatSession[] {
  return useMemo(() => {
    if (!query.trim()) return [];
    const all = getChatSessions();
    const q = query.toLowerCase();
    return all.filter(s =>
      s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [query]);
}
