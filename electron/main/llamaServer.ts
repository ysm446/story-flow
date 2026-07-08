import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app } from 'electron'
import type { AppSettings, LlamaServerInstall, LlamaServerStatus, ModelMetadata, ModelOption } from './types'

const DEFAULT_PORT = 8080
const DEFAULT_CONTEXT_LENGTH = 32768
const DEFAULT_TEMPERATURE = 0.8

/**
 * writer 用 llama-server の管理（lm-graph から移植）。
 * インストール先は runtime/、モデルは models/ 配下の GGUF を列挙する。
 * TODO(v1 Vault): embedding 用の第二サーバ管理（Qwen3-Embedding-4B, --embedding 起動）を追加する。
 */
export class LlamaServerManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private readonly rootDir: string
  private readonly runtimeDir: string
  private serverPath: string | null
  private serverBuild: string | null = null
  private readonly modelsDir: string
  private readonly modelMetadataCache = new Map<string, Partial<ModelMetadata>>()
  private port = DEFAULT_PORT
  private settings: AppSettings

  constructor() {
    this.rootDir = resolveAppRoot()
    this.runtimeDir = join(this.rootDir, 'runtime')
    this.modelsDir = join(this.rootDir, 'models')
    this.serverPath = resolveLlamaServerPath(this.rootDir)
    this.serverBuild = this.serverPath ? extractBuildLabel(this.serverPath) : null
    this.settings = this.buildSettings(findDefaultModel(this.listModels()))
  }

  /** インストーラが新しい llama-server を配置するディレクトリ */
  getRuntimeDir(): string {
    return this.runtimeDir
  }

  getSettings(): AppSettings {
    return {
      ...this.settings,
      availableModels: [...this.settings.availableModels]
    }
  }

  async getRuntimeSettings(): Promise<AppSettings> {
    return {
      ...this.getSettings(),
      isModelLoaded: await this.isHealthy()
    }
  }

  /** writer 用モデル一覧。mmproj と embedding 用モデルは除外する */
  listModels(): ModelOption[] {
    if (!existsSync(this.modelsDir)) {
      return []
    }
    return walkFiles(this.modelsDir)
      .filter((file) => file.toLowerCase().endsWith('.gguf'))
      .filter((file) => !/mmproj/i.test(file))
      .filter((file) => !/embedding/i.test(file))
      .map((file) => ({
        path: file,
        name: relative(this.modelsDir, file).replace(/\\/g, '/'),
        sizeBytes: statSync(file).size,
        metadata: mergeModelMetadata(
          buildFilenameModelMetadata(relative(this.modelsDir, file).replace(/\\/g, '/')),
          this.modelMetadataCache.get(resolve(file))
        )
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  getServerStatus(): LlamaServerStatus {
    const installs = findServerInstalls(this.rootDir)
    return {
      installed: this.serverPath !== null,
      build: this.serverBuild,
      path: this.serverPath,
      installDir: this.serverPath ? dirname(this.serverPath) : null,
      installRoot: this.runtimeDir,
      installs
    }
  }

  /** インストール直後などにディスクを再走査して設定を組み直す */
  async rescan(): Promise<AppSettings> {
    this.serverPath = resolveLlamaServerPath(this.rootDir)
    this.serverBuild = this.serverPath ? extractBuildLabel(this.serverPath) : null
    const models = this.listModels()
    const current =
      models.find((model) => resolve(model.path) === resolve(this.settings.selectedModelPath)) ??
      findDefaultModel(models)
    this.settings = this.buildSettings(current, models, this.settings.contextLength, this.settings.temperature)
    return this.getRuntimeSettings()
  }

  async selectModel(modelPath: string): Promise<AppSettings> {
    if (!this.serverPath) {
      throw new Error('llama.cpp server is not installed. Install it from the setup panel.')
    }
    const resolvedPath = resolve(modelPath)
    const availableModels = this.listModels()
    const selected = availableModels.find((model) => resolve(model.path) === resolvedPath)
    if (!selected) {
      throw new Error('Selected model was not found in models/.')
    }

    const shouldRestart = this.process !== null
    if (shouldRestart) {
      await this.stop()
    }
    this.settings = this.buildSettings(selected, availableModels)
    await this.ensureRunning()
    return this.getRuntimeSettings()
  }

  async updateSettings(input: { contextLength?: number; temperature?: number }): Promise<AppSettings> {
    const nextContextLength = input.contextLength ?? this.settings.contextLength
    const nextTemperature = input.temperature ?? this.settings.temperature
    const availableModels = this.listModels()
    const currentModel =
      availableModels.find((model) => resolve(model.path) === resolve(this.settings.selectedModelPath)) ??
      findDefaultModel(availableModels)

    const changed = nextContextLength !== this.settings.contextLength
    if (changed && this.process) {
      await this.stop()
    }

    this.settings = this.buildSettings(currentModel, availableModels, nextContextLength, nextTemperature)
    return this.getRuntimeSettings()
  }

  async ensureRunning(): Promise<AppSettings> {
    if (!this.serverPath) {
      throw new Error('llama.cpp server is not installed. Install it from the setup panel.')
    }
    if (!this.settings.selectedModelPath) {
      throw new Error('No GGUF model was found in models/. Add a model file first.')
    }
    await this.ensureAvailablePort()
    if (await this.isHealthy()) {
      await this.refreshSelectedModelMetadata()
      return this.getRuntimeSettings()
    }
    if (!this.process) {
      this.start()
    }
    await this.waitForHealthy()
    await this.refreshSelectedModelMetadata()
    return this.getRuntimeSettings()
  }

  async stop(): Promise<void> {
    const proc = this.process
    this.process = null
    if (!proc) return
    if (proc.killed || proc.exitCode !== null) return

    proc.kill()
    const exited = await waitForProcessExit(proc, 5_000)
    if (exited || !proc.pid) return

    const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
    await new Promise<void>((resolve) => {
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    })
    await waitForProcessExit(proc, 2_000)
  }

  private buildSettings(
    selectedModel: ModelOption | null,
    availableModels = this.listModels(),
    contextLength = this.settings?.contextLength ?? DEFAULT_CONTEXT_LENGTH,
    temperature = this.settings?.temperature ?? DEFAULT_TEMPERATURE
  ): AppSettings {
    const resolvedMmprojPath = selectedModel ? findMmprojForModel(selectedModel.path) : null
    return {
      llamaBaseUrl: `http://127.0.0.1:${this.port}`,
      llamaModelAlias: selectedModel ? toModelAlias(selectedModel.name) : 'local-model',
      selectedModelPath: selectedModel?.path ?? '',
      selectedModelName: selectedModel?.name ?? '',
      contextLength,
      temperature,
      availableModels,
      resolvedModelPath: selectedModel?.path ?? '',
      resolvedMmprojPath,
      resolvedServerPath: this.serverPath ?? '',
      supportsVision: Boolean(resolvedMmprojPath),
      isModelLoaded: false,
      isServerInstalled: this.serverPath !== null,
      serverBuild: this.serverBuild
    }
  }

  private start(): void {
    const { resolvedServerPath, resolvedModelPath, resolvedMmprojPath, llamaModelAlias } = this.settings
    const args = [
      '--host',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--model',
      resolvedModelPath,
      '--alias',
      llamaModelAlias,
      '--ctx-size',
      String(this.settings.contextLength),
      '--flash-attn',
      'on',
      '--reasoning',
      'off',
      '--reasoning-format',
      'none',
      '--chat-template-kwargs',
      '{"thinking":false}',
      '--n-gpu-layers',
      '999'
    ]
    if (resolvedMmprojPath) {
      args.push('--mmproj', resolvedMmprojPath)
    }

    this.process = spawn(resolvedServerPath, args, {
      cwd: join(resolvedServerPath, '..'),
      windowsHide: true
    })
    this.process.stdout.on('data', (data) => process.stdout.write(`[llama-server] ${data}`))
    this.process.stderr.on('data', (data) => process.stderr.write(`[llama-server] ${data}`))
    this.process.on('exit', () => {
      this.process = null
    })
  }

  private async ensureAvailablePort(): Promise<void> {
    if (this.process) return
    const availablePort = await findAvailablePort(DEFAULT_PORT)
    if (availablePort === this.port) return
    this.port = availablePort
    const availableModels = this.listModels()
    const currentModel =
      availableModels.find((model) => resolve(model.path) === resolve(this.settings.selectedModelPath)) ??
      findDefaultModel(availableModels)
    this.settings = this.buildSettings(currentModel, availableModels, this.settings.contextLength, this.settings.temperature)
  }

  private async waitForHealthy(): Promise<void> {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (await this.isHealthy()) return
      await delay(1_000)
    }
    throw new Error('llama.cpp server did not become ready within 90 seconds.')
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.settings.llamaBaseUrl}/health`)
      return response.ok
    } catch {
      return false
    }
  }

  private async refreshSelectedModelMetadata(): Promise<void> {
    const metadata = await fetchModelMetadataFromServer(this.settings.llamaBaseUrl, this.settings.llamaModelAlias)
    if (!metadata) return

    const cacheKey = resolve(this.settings.selectedModelPath)
    const currentMetadata = this.modelMetadataCache.get(cacheKey)
    const nextMetadata = mergeModelMetadata(
      buildFilenameModelMetadata(this.settings.selectedModelName),
      { ...currentMetadata, ...metadata }
    )
    this.modelMetadataCache.set(cacheKey, nextMetadata)

    const currentModel = this.listModels().find((model) => resolve(model.path) === cacheKey)
    if (!currentModel) return
    this.settings = this.buildSettings(currentModel, this.listModels(), this.settings.contextLength, this.settings.temperature)
  }
}

export async function findAvailablePort(startPort: number, attempts = 20): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset
    if (await canListen(candidate)) {
      return candidate
    }
  }
  throw new Error(`No available port was found for llama.cpp starting at ${startPort}.`)
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function waitForProcessExit(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null) return true
  return await new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      proc.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    proc.once('exit', onExit)
  })
}

function findDefaultModel(models: ModelOption[]): ModelOption | null {
  return models[0] ?? null
}

function toModelAlias(modelName: string): string {
  return basename(modelName, '.gguf').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'local-model'
}

async function fetchModelMetadataFromServer(llamaBaseUrl: string, modelAlias: string): Promise<Partial<ModelMetadata> | null> {
  try {
    const response = await fetch(`${llamaBaseUrl}/v1/models`)
    if (!response.ok) return null
    const payload = await response.json() as { data?: unknown }
    const entries = Array.isArray(payload.data) ? payload.data : []
    const modelEntry = entries.find((entry) => {
      if (!isRecord(entry)) return false
      return typeof entry.id === 'string' && entry.id === modelAlias
    }) ?? entries[0]

    if (!isRecord(modelEntry)) return null

    const meta = isRecord(modelEntry.meta) ? modelEntry.meta : null
    const parameterCount = meta ? readParameterCount(meta) : null
    const quantizationLabel = extractQuantizationLabel(
      typeof modelEntry.id === 'string'
        ? modelEntry.id
        : (typeof modelEntry.path === 'string' ? modelEntry.path : '')
    )

    return {
      quantizationLabel,
      parameterCount,
      parameterLabel: formatParameterCount(parameterCount),
      source: parameterCount !== null || quantizationLabel ? 'server' : null
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readParameterCount(meta: Record<string, unknown>): number | null {
  const candidates = [
    meta.n_params,
    meta.parameter_count,
    meta.parameters
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
    if (typeof candidate === 'string') {
      const parsed = Number(candidate)
      if (Number.isFinite(parsed)) return parsed
    }
  }

  return null
}

function buildFilenameModelMetadata(modelName: string): ModelMetadata {
  const quantizationLabel = extractQuantizationLabel(modelName)
  const parameterLabel = extractParameterLabelFromName(modelName)
  return {
    quantizationLabel,
    parameterCount: null,
    parameterLabel,
    source: quantizationLabel || parameterLabel ? 'filename' : null
  }
}

function mergeModelMetadata(base: ModelMetadata, override?: Partial<ModelMetadata>): ModelMetadata {
  return {
    quantizationLabel: override?.quantizationLabel ?? base.quantizationLabel,
    parameterCount: override?.parameterCount ?? base.parameterCount,
    parameterLabel: override?.parameterLabel ?? base.parameterLabel,
    source: override?.source ?? base.source
  }
}

function extractQuantizationLabel(value: string): string | null {
  const normalized = basename(value, '.gguf')
  const match = normalized.match(/(?:^|[-_ ])((?:IQ|Q)\d(?:_[A-Z0-9]+)+)(?:$|[-_ ])/i)
  if (!match) return null
  const upper = match[1].toUpperCase()
  const reordered = upper.replace(/^Q(\d)(.*)$/i, '$1Q$2')
  return reordered
}

function extractParameterLabelFromName(modelName: string): string | null {
  const match = modelName.match(/(\d+(?:\.\d+)?)\s*[Bb](?:[^a-zA-Z]|$)/)
  return match ? `${match[1]}B` : null
}

function formatParameterCount(parameterCount: number | null): string | null {
  if (parameterCount === null || !Number.isFinite(parameterCount) || parameterCount <= 0) return null
  const valueInBillions = parameterCount / 1_000_000_000
  const rounded = valueInBillions >= 10
    ? Math.round(valueInBillions)
    : Math.round(valueInBillions * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}B`
}

function findMmprojForModel(modelPath: string): string | null {
  const modelDir = dirname(modelPath)
  if (!existsSync(modelDir)) return null
  const mmprojFiles = walkFiles(modelDir)
    .filter((file) => file.toLowerCase().endsWith('.gguf'))
    .filter((file) => /mmproj/i.test(basename(file)))
    .sort((left, right) => basename(left).localeCompare(basename(right)))
  return mmprojFiles[0] ?? null
}

function collectServerCandidates(rootDir: string): string[] {
  const serverRoot = join(rootDir, 'runtime')
  if (!existsSync(serverRoot)) return []

  const candidates: string[] = []
  const directPath = join(serverRoot, 'llama-server.exe')
  if (existsSync(directPath)) candidates.push(directPath)

  for (const entry of readdirSync(serverRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nestedPath = join(serverRoot, entry.name, 'llama-server.exe')
    if (existsSync(nestedPath)) candidates.push(nestedPath)
  }
  return candidates
}

export function resolveLlamaServerPath(rootDir: string): string | null {
  const candidates = collectServerCandidates(rootDir)
  if (candidates.length === 0) return null
  candidates.sort(compareServerCandidates)
  return candidates[0]
}

function findServerInstalls(rootDir: string): LlamaServerInstall[] {
  return collectServerCandidates(rootDir)
    .sort(compareServerCandidates)
    .map((serverPath) => ({
      build: extractBuildLabel(serverPath),
      dir: dirname(serverPath),
      path: serverPath
    }))
}

function extractBuildLabel(serverPath: string): string | null {
  const parentDirName = basename(dirname(serverPath))
  const buildMatch = parentDirName.match(/(?:^|[^0-9a-z])(b\d+)(?:[^0-9a-z]|$)/i)
  return buildMatch ? buildMatch[1].toLowerCase() : null
}

function compareServerCandidates(left: string, right: string): number {
  const leftScore = getServerCandidateScore(left)
  const rightScore = getServerCandidateScore(right)

  if (leftScore.build !== rightScore.build) {
    return rightScore.build - leftScore.build
  }
  if (leftScore.mtimeMs !== rightScore.mtimeMs) {
    return rightScore.mtimeMs - leftScore.mtimeMs
  }
  return left.localeCompare(right)
}

function getServerCandidateScore(serverPath: string): { build: number; mtimeMs: number } {
  const parentDirName = basename(dirname(serverPath))
  const buildMatch = parentDirName.match(/(?:^|[^0-9])b(\d+)(?:[^0-9]|$)/i)
  return {
    build: buildMatch ? Number.parseInt(buildMatch[1], 10) : -1,
    mtimeMs: statSync(serverPath).mtimeMs
  }
}

export function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

export function resolveAppRoot(): string {
  const candidates = [
    process.cwd(),
    resolve(app.getAppPath(), '..', '..'),
    app.getAppPath()
  ]

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'models')) || existsSync(join(candidate, 'runtime'))) {
      return candidate
    }
  }

  return process.cwd()
}
