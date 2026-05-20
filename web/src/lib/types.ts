// Types matching Flask API responses

export interface ApiStatus {
  service_running: boolean;
  last_sync: string | null;
  last_count: number | null;
  last_error: string | null;
  documents: number;
  collections: string[];
  databases: string[];
}

export interface ApiModels {
  models: string[];
  current: string;
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
