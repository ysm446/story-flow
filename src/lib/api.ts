// FastAPI バックエンドの HTTP クライアント。
// baseUrl は bootstrap（Electron main から取得）で上書きされる。

let baseUrl = 'http://127.0.0.1:8600'

export function configureApi(nextBaseUrl: string): void {
  baseUrl = nextBaseUrl.replace(/\/$/, '')
}

export function getApiBaseUrl(): string {
  return baseUrl
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`API ${path} failed: ${response.status} ${body}`.trim())
  }
  return (await response.json()) as T
}

export type CardRole = 'intro' | 'rising' | 'turn' | 'climax' | 'ending'
export type CardTone = 'happy' | 'bad' | 'bitter' | 'neutral'

export interface Card {
  id: string
  title: string
  brief: string
  media_path: string | null
  media_type: 'image' | 'video' | null
  role: CardRole
  tone: CardTone | null
  created_at: string
  updated_at: string
}

export interface VaultStats {
  total: number
  by_role: Record<CardRole, number>
}

export interface StorySummary {
  id: string
  plot: string | null
  target_tone: string | null
  created_at: string
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  listCards: () => request<{ cards: Card[] }>('/cards'),
  vaultStats: () => request<VaultStats>('/vault/stats'),
  listStories: () => request<{ stories: StorySummary[] }>('/stories')
}
