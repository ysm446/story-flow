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
  role: CardRole | null // null = 自動/汎用
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
  role: CardRole | null
  tone: CardTone | null
  tags: CardTag[]
}

export interface VaultStats {
  total: number
  embedded: number
  by_role: Record<CardRole, number>
  unassigned: number
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
  workspace_id: string | null
  created_at: string
}

export interface WorkspaceGraphNode {
  id: string
  x: number
  y: number
  /** この作品でのこのシーンへの追加指示（ノードのプロパティ） */
  instruction?: string | null
}

export interface WorkspaceGraphEdge {
  id: string
  source: string
  target: string
}

export interface WorkspaceGraph {
  nodes: WorkspaceGraphNode[]
  edges: WorkspaceGraphEdge[]
}

export interface WorkspaceSummary {
  id: string
  name: string
  story_count: number
  created_at: string
  updated_at: string
}

export type SceneLength = 'short' | 'standard' | 'long'

export interface Workspace {
  id: string
  name: string
  graph: WorkspaceGraph
  plot: string
  target_tone: CardTone | null
  prompt_preset_id: string | null
  scene_length: SceneLength | null
  created_at: string
  updated_at: string
}

export interface WorkspaceUpdateInput {
  name?: string
  graph?: WorkspaceGraph
  plot?: string
  target_tone?: CardTone | null
  clear_target_tone?: boolean
  prompt_preset_id?: string | null
  clear_prompt_preset?: boolean
  scene_length?: SceneLength | null
  clear_scene_length?: boolean
}

export interface StoryScene {
  id: string
  story_id: string
  position: number
  card_id: string
  prose: string
  is_fixed: number
  selection_reason: string | null
  state_after: string | null
}

export interface StoryDetail extends StorySummary {
  scenes: StoryScene[]
}

export interface PromptPreset {
  id: string
  name: string
  content: string
  created_at: string
  updated_at: string
}

export interface PromptConfig {
  name: string
  default: string
  active_id: string | null
  presets: PromptPreset[]
}

export type PromptKind = 'writer' | 'selector'

export interface StoryStateSnapshot {
  characters: Array<{ name: string; traits: string }>
  items: string[]
  events: string[]
  location: string | null
  time: string | null
  tone_so_far: string | null
}

export type GenerateEvent =
  | {
      type: 'scene'
      position: number
      total: number
      card_id: string
      card_title: string
      prose: string
      state_after: StoryStateSnapshot
      is_fixed: boolean
    }
  | { type: 'done'; story_id: string }
  | { type: 'error'; message: string }

export interface GenerateSlot {
  card_id: string
  instruction: string | null
}

export interface GenerateInput {
  slots: GenerateSlot[]
  plot: string
  target_tone: CardTone | null
  writer_base_url: string | null
  workspace_id: string | null
  prompt_preset_id: string | null
  scene_length: SceneLength | null
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

  getPromptConfig: (kind: PromptKind) => request<PromptConfig>(`/prompts/${kind}`),

  createPromptPreset: (kind: PromptKind, name: string, content?: string) =>
    request<PromptPreset>(`/prompts/${kind}/presets`, {
      method: 'POST',
      body: JSON.stringify({ name, content: content ?? null })
    }),

  updatePromptPreset: (kind: PromptKind, presetId: string, patch: { name?: string; content?: string }) =>
    request<PromptPreset>(`/prompts/${kind}/presets/${presetId}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    }),

  deletePromptPreset: (kind: PromptKind, presetId: string) =>
    request<{ ok: boolean }>(`/prompts/${kind}/presets/${presetId}`, { method: 'DELETE' }),

  setActivePrompt: (kind: PromptKind, presetId: string | null) =>
    request<PromptConfig>(`/prompts/${kind}/active`, {
      method: 'PUT',
      body: JSON.stringify({ preset_id: presetId })
    }),

  listStories: (workspaceId?: string) =>
    request<{ stories: StorySummary[] }>(
      `/stories${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`
    ),

  listWorkspaces: () => request<{ workspaces: WorkspaceSummary[] }>('/workspaces'),

  createWorkspace: (name: string) =>
    request<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),

  getWorkspace: (workspaceId: string) => request<Workspace>(`/workspaces/${workspaceId}`),

  updateWorkspace: (workspaceId: string, patch: WorkspaceUpdateInput) =>
    request<Workspace>(`/workspaces/${workspaceId}`, { method: 'PUT', body: JSON.stringify(patch) }),

  duplicateWorkspace: (workspaceId: string, name: string) =>
    request<Workspace>(`/workspaces/${workspaceId}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name })
    }),

  deleteWorkspace: (workspaceId: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}`, { method: 'DELETE' }),

  getStory: (storyId: string) => request<StoryDetail>(`/stories/${storyId}`),

  deleteStory: (storyId: string) => request<{ ok: boolean }>(`/stories/${storyId}`, { method: 'DELETE' }),

  getCard: (cardId: string) => request<Card>(`/cards/${cardId}`)
}
