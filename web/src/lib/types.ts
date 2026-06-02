// Types matching Flask API responses

export interface ApiStatus {
  service_running: boolean;
  last_sync: string | null;
  last_count: number | null;
  last_error: string | null;
  documents: number;
  collections: string[];
  databases: string[];
  local_notes_path?: string;
  local_notes_connected?: boolean;
  notion_token_set?: boolean;
}

export interface ApiModels {
  models: string[];
  current: string;
  provider?: "local" | "online";
}

export interface SearchResult {
  title: string;
  content: string;
  source: string;
  database: string;
  page_id: string;
}

export interface SyncResponse {
  success?: boolean;
  synced?: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sources?: SearchResult[];
  model?: string;
  thinking?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  database: string;
  updated: string;
  created: string;
  tags: string;
  status: string;
}

export interface AppSettings {
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
  review?: {
    summary_prompt?: string;
    auto_show_summary?: boolean;
  };
  local_notes?: {
    path: string;
  };
  web: {
    port: number;
  };
}

export interface ChatResponse {
  answer: string;
  sources: SearchResult[];
  model: string;
}
