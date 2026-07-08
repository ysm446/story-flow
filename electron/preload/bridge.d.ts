import type {
  AppSettings,
  BackendStatus,
  BootstrapPayload,
  EmbeddingStatus,
  LlamaInstallProgress,
  LlamaRelease,
  LlamaReleaseVariant,
  LlamaServerStatus
} from '../main/types'

export interface StoryFlowBridge {
  bootstrap(): Promise<BootstrapPayload>
  getBackendStatus(): Promise<BackendStatus>
  ensureBackend(): Promise<BackendStatus>
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
}

declare global {
  interface Window {
    storyFlow: StoryFlowBridge
  }
}

export {}
