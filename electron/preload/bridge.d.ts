import type {
  AppSettings,
  BackendStatus,
  BootstrapPayload,
  EmbeddingStatus,
  LlamaInstallProgress,
  LlamaRelease,
  LlamaReleaseVariant,
  LlamaServerStatus,
  SystemResources
} from '../main/types'

export interface StoryFlowBridge {
  bootstrap(): Promise<BootstrapPayload>
  getBackendStatus(): Promise<BackendStatus>
  ensureBackend(): Promise<BackendStatus>
  setFullScreen(value: boolean): Promise<boolean>
  toggleFullScreen(): Promise<boolean>
  getEmbeddingStatus(): Promise<EmbeddingStatus>
  ensureEmbedding(): Promise<EmbeddingStatus>
  stopEmbedding(): Promise<EmbeddingStatus>
  listModels(): Promise<AppSettings>
  selectModel(modelPath: string): Promise<{ settings: AppSettings }>
  ejectModel(): Promise<{ settings: AppSettings }>
  ensureLlama(): Promise<{ settings: AppSettings }>
  getLlamaStatus(): Promise<LlamaServerStatus>
  fetchLlamaReleases(): Promise<LlamaRelease[]>
  installLlamaServer(
    variant: LlamaReleaseVariant
  ): Promise<
    | { ok: true; settings: AppSettings; status: LlamaServerStatus }
    | { ok: false; canceled: boolean; message: string }
  >
  cancelLlamaInstall(): Promise<{ ok: true }>
  onLlamaInstallProgress(callback: (payload: LlamaInstallProgress) => void): () => void
  onSystemResources(callback: (payload: SystemResources) => void): () => void
  loadUiSettings(): Promise<Record<string, unknown>>
  saveUiSettings(settings: Record<string, unknown>): Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    storyFlow: StoryFlowBridge
  }
}

export {}
