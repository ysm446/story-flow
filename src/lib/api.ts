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
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body)
    } catch {
      detail = await response.text().catch(() => '')
    }
    throw new Error(detail || `API ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

export type CardRole = 'intro' | 'rising' | 'turn' | 'climax' | 'ending'
export type CardTone = 'happy' | 'bad' | 'bitter' | 'neutral'
export type TagType = 'place' | 'time' | 'mood'

export interface CardTag {
  tag_type: TagType
  value: string
}

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
  tags: CardTag[]
  has_embedding: boolean
  distance?: number
}

export interface CardInput {
  title: string
  brief: string
  role: CardRole
  tone: CardTone | null
  tags: CardTag[]
}

export interface VaultStats {
  total: number
  embedded: number
  by_role: Record<CardRole, number>
  tags: Record<TagType, Array<{ value: string; count: number }>>
}

export interface ListCardsParams {
  q?: string
  semantic?: string
  role?: CardRole | ''
  place?: string
  time?: string
  mood?: string
}

export interface StorySummary {
  id: string
  plot: string | null
  target_tone: string | null
  created_at: string
}

export function cardFileUrl(cardId: string, thumb: boolean): string {
  return `${baseUrl}/cards/${cardId}/file?thumb=${thumb ? 1 : 0}`
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  listCards: (params: ListCardsParams = {}) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value)
    }
    const query = search.toString()
    return request<{ cards: Card[]; total: number }>(`/cards${query ? `?${query}` : ''}`)
  },

  createCard: (input: CardInput) =>
    request<Card>('/cards', { method: 'POST', body: JSON.stringify(input) }),

  updateCard: (cardId: string, input: CardInput) =>
    request<Card>(`/cards/${cardId}`, { method: 'PUT', body: JSON.stringify(input) }),

  deleteCard: (cardId: string) => request<{ ok: boolean }>(`/cards/${cardId}`, { method: 'DELETE' }),

  uploadMedia: async (cardId: string, file: File): Promise<Card> => {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(`${baseUrl}/cards/${cardId}/media`, { method: 'POST', body: form })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { detail?: string } | null
      throw new Error(body?.detail ?? `upload failed: ${response.status}`)
    }
    return (await response.json()) as Card
  },

  similarByCard: (cardId: string, k = 6) =>
    request<{ cards: Card[] }>(`/cards/similar?card_id=${encodeURIComponent(cardId)}&k=${k}`),

  similarByText: (text: string, k = 6) =>
    request<{ cards: Card[] }>(`/cards/similar?text=${encodeURIComponent(text)}&k=${k}`),

  vaultStats: () => request<VaultStats>('/vault/stats'),

  listStories: () => request<{ stories: StorySummary[] }>('/stories')
}
