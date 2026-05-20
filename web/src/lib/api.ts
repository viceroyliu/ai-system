// API client for Flask backend at localhost:5100

const BASE = 'http://localhost:5100/api';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  if (!r.ok) throw new Error(`API ${method} ${path} failed: ${r.status}`);
  return r.json() as Promise<T>;
}

export type Todo = {
  id: string;
  title: string;
  tag: "study" | "work" | "exercise" | "reading" | "reflection";
  priority: "high" | "medium" | "low";
  estimatedMinutes: number;
  completedAt: string | null;
  createdAt: string;
};

export type Review = {
  id: string;
  date: string;
  type: "daily" | "weekly" | "monthly";
  content: string;
  aiInsights: string;
  notionPageId: string | null;
  createdAt: string;
};

export const apiClient = {
  getStatus: () => api<import('./types').ApiStatus>('GET', '/status'),
  getModels: () => api<import('./types').ApiModels>('GET', '/models'),
  setModel: (model: string) =>
    api<{ ok: boolean; model: string }>('POST', '/model', { model }),
  sync: () => api<import('./types').SyncResponse>('POST', '/sync'),
  search: (query: string, limit = 5) =>
    api<{ results: import('./types').SearchResult[] }>('POST', '/search', { query, limit }),
  getLogs: () => api<{ lines: string[] }>('GET', '/logs'),
  // 新增 API
  getNotes: () =>
    api<{ notes: import('./types').NoteItem[] }>('GET', '/notes'),
  getSettings: () => api<import('./types').AppSettings>('GET', '/settings'),
  saveSettings: (data: Partial<import('./types').AppSettings>) =>
    api<{ ok: boolean }>('POST', '/settings', data),
  chat: (query: string, model?: string) =>
    api<import('./types').ChatResponse>('POST', '/chat', { query, model }),
  // TODO & Reviews
  getTodos: () => api<{ todos: Todo[] }>('GET', '/todos'),
  createTodo: (data: Omit<Todo, "id" | "completedAt" | "createdAt">) =>
    api<{ todo: Todo }>('POST', '/todos', data),
  patchTodo: (id: string, data: { completed?: boolean; title?: string; tag?: string; priority?: string }) =>
    api<{ ok: boolean }>('PATCH', `/todos/${id}`, data),
  deleteTodo: (id: string) =>
    api<{ ok: boolean }>('DELETE', `/todos/${id}`),
  getReviews: () => api<{ reviews: Review[] }>('GET', '/reviews'),
  createReview: (data: Omit<Review, "id" | "notionPageId" | "createdAt">) =>
    api<{ review: Review }>('POST', '/reviews', data),
  deleteReview: (id: string) =>
    api<{ ok: boolean }>('DELETE', `/reviews/${id}`),
};

export type NoteItem = {
  id: string;
  title: string;
  content: string;
  database: string;
  updated: string;
};

export type AppSettings = {
  notion: {
    token: string;
    databases: Record<string, { id: string; name: string }>;
  };
  lm_studio: {
    url: string;
    default_model: string;
  };
  sync: {
    interval: number;
    auto_title: boolean;
  };
  web: {
    port: number;
  };
};

export type ChatResponse = {
  answer: string;
  sources: import('./types').SearchResult[];
  model: string;
};
