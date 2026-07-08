export interface ModelOption {
  name: string
  path: string
  sizeBytes: number
  metadata: ModelMetadata
}

export interface ModelMetadata {
  quantizationLabel: string | null
  parameterCount: number | null
  parameterLabel: string | null
  source: 'filename' | 'server' | null
}

export interface AppSettings {
  llamaBaseUrl: string
  llamaModelAlias: string
  selectedModelPath: string
  selectedModelName: string
  contextLength: number
  temperature: number
  availableModels: ModelOption[]
  resolvedModelPath: string
  resolvedMmprojPath: string | null
  resolvedServerPath: string
  supportsVision: boolean
  isModelLoaded: boolean
  isServerInstalled: boolean
  serverBuild: string | null
}

export type LlamaBackendFamily = 'cuda' | 'cpu' | 'vulkan' | 'hip' | 'sycl' | 'other'

export interface LlamaReleaseVariant {
  key: string
  label: string
  family: LlamaBackendFamily
  assetName: string
  assetUrl: string
  sizeBytes: number
  cudartName: string | null
  cudartUrl: string | null
  cudartSizeBytes: number | null
}

export interface LlamaRelease {
  tag: string
  name: string
  publishedAt: string | null
  htmlUrl: string
  variants: LlamaReleaseVariant[]
}

export interface LlamaServerInstall {
  build: string | null
  dir: string
  path: string
}

export interface LlamaServerStatus {
  installed: boolean
  build: string | null
  path: string | null
  installDir: string | null
  installRoot: string
  installs: LlamaServerInstall[]
}

export type LlamaInstallProgress =
  | { phase: 'download'; fileLabel: string; received: number; total: number | null; percent: number | null }
  | { phase: 'extract'; fileLabel: string }
  | { phase: 'done'; build: string | null; path: string }
  | { phase: 'error'; message: string }
  | { phase: 'canceled' }

export interface BackendStatus {
  baseUrl: string
  running: boolean
  healthy: boolean
  pythonPath: string
  venvExists: boolean
}

export interface EmbeddingStatus {
  baseUrl: string
  serverInstalled: boolean
  modelPath: string | null
  modelName: string | null
  running: boolean
  healthy: boolean
}

export interface BootstrapPayload {
  backend: BackendStatus
  settings: AppSettings
  llamaStatus: LlamaServerStatus
  embedding: EmbeddingStatus
}
