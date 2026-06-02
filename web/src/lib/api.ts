// API client for Flask backend at localhost:5100

const BASE = 'http://localhost:5100/api';
export const API_BASE = BASE;

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
  tag: "study" | "work" | "exercise" | "reading" | "reflection" | "not_started" | "in_progress";
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
  title?: string;
  notionPageId: string | null;
  createdAt: string;
};

export const apiClient = {
  getStatus: () => api<import('./types').ApiStatus>('GET', '/status'),
  getModels: () => api<import('./types').ApiModels>('GET', '/models'),
  setModel: (model: string, provider?: 'local' | 'online') =>
    api<{ ok: boolean; model: string; provider: string }>('POST', '/model', { model, provider }),
  sync: () => api<import('./types').SyncResponse>('POST', '/sync'),
  reindex: () => api<{ success?: boolean; reindexed?: number; error?: string }>('POST', '/reindex'),
  search: (query: string, limit = 5) =>
    api<{ results: import('./types').SearchResult[] }>('POST', '/search', { query, limit }),
  getLogs: () => api<{ lines: string[] }>('GET', '/logs'),
  // 新增 API
  getNotes: () =>
    api<{ notes: import('./types').NoteItem[] }>('GET', '/notes'),
  createNote: (data: { title: string; database: string }) =>
    api<{ note: NoteItem }>('POST', '/notes', data),
  getSettings: () => api<import('./types').AppSettings>('GET', '/settings'),
  getSettingsSecret: () => api<{ notion_token: string; local_notes_path: string }>('GET', '/settings/secret'),
  saveSettings: (data: Partial<import('./types').AppSettings> & {
    notion_databases?: Record<string, { id: string; name: string }>;
    notion_token?: string;
    local_notes?: { path: string };
    lm_studio?: { url: string; default_model: string };
    online?: { url: string; api_key: string; default_model: string };
    sync?: { interval: number; auto: boolean; auto_title: boolean };
    review?: { summary_prompt: string; auto_show_summary?: boolean };
  }) => api<{ ok: boolean }>('POST', '/settings', data),
  chat: (query: string, model?: string, sources?: string[], no_rag?: boolean, ref_note_ids?: string[], provider?: string) =>
    api<import('./types').ChatResponse>('POST', '/chat', { query, model, sources, no_rag, ref_note_ids, provider }),
  getOnlineModels: () => api<{ models: string[] }>('GET', '/online_models'),
  getNote: (id: string) => api<NoteDetail>('GET', `/note/${id}`),
  updateNote: (id: string, data: { title?: string; content?: string; tags?: string; status?: string }) =>
    api<{ ok: boolean }>('PATCH', `/note/${id}`, data),
  deleteNote: (id: string) => api<{ ok: boolean }>('DELETE', `/note/${id}`),
  // TODO & Reviews
  getTodos: () => api<{ todos: Todo[] }>('GET', '/todos'),
  createTodo: (data: Omit<Todo, "id" | "completedAt" | "createdAt">) =>
    api<{ todo: Todo }>('POST', '/todos', data),
  patchTodo: (id: string, data: { completed?: boolean; completedAt?: string; title?: string; tag?: string; priority?: string }) =>
    api<{ ok: boolean }>('PATCH', `/todos/${id}`, data),
  deleteTodo: (id: string) =>
    api<{ ok: boolean }>('DELETE', `/todos/${id}`),
  getReviews: () => api<{ reviews: Review[] }>('GET', '/reviews'),
  createReview: (data: Omit<Review, "id" | "notionPageId" | "createdAt">) =>
    api<{ review: Review }>('POST', '/reviews', data),
  patchReview: (id: string, data: { date?: string; content?: string; type?: string }) =>
    api<{ ok: boolean }>('PATCH', `/reviews/${id}`, data),
  deleteReview: (id: string) =>
    api<{ ok: boolean }>('DELETE', `/reviews/${id}`),
};

export type NoteItem = {
  id: string;
  title: string;
  content: string;
  database: string;
  updated: string;
  created: string;
  tags: string;
  status: string;
};

export type NoteDetail = {
  title: string;
  content: string;
  created: string;
  updated: string;
  url: string;
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
  online?: {
    url: string;
    api_key?: string;
    default_model?: string;
  };
  sync: {
    interval: number;
    auto: boolean;
    auto_title: boolean;
  };
  local_notes?: {
    path: string;
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
