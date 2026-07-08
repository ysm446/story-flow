import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { findAvailablePort, resolveLlamaServerPath, walkFiles } from './llamaServer'
import type { EmbeddingStatus } from './types'

const DEFAULT_EMBEDDING_PORT = 8091
const EMBEDDING_CTX_SIZE = 8192

/**
 * 埋め込み用 llama-server（Qwen3-Embedding-4B）の管理。
 * models/ 配下の "embedding" を名前に含む GGUF を使い、--embedding --pooling last で起動する。
 * バックエンドへは baseUrl を環境変数（STORY_FLOW_EMBEDDING_URL）として注入する。
 */
export class EmbeddingServerManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private readonly rootDir: string
  private readonly modelsDir: string
  private port = DEFAULT_EMBEDDING_PORT

  constructor(rootDir: string) {
    this.rootDir = rootDir
    this.modelsDir = join(rootDir, 'models')
  }

  /** バックエンド起動前に呼び、利用ポートを確定させる */
  async init(): Promise<void> {
    this.port = await findAvailablePort(DEFAULT_EMBEDDING_PORT)
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  findEmbeddingModel(): string | null {
    if (!existsSync(this.modelsDir)) return null
    const candidates = walkFiles(this.modelsDir)
      .filter((file) => file.toLowerCase().endsWith('.gguf'))
      .filter((file) => !/mmproj/i.test(file))
      .filter((file) => /embedding/i.test(file))
      .sort()
    return candidates[0] ?? null
  }

  async getStatus(): Promise<EmbeddingStatus> {
    const modelPath = this.findEmbeddingModel()
    return {
      baseUrl: this.baseUrl,
      serverInstalled: resolveLlamaServerPath(this.rootDir) !== null,
      modelPath,
      modelName: modelPath ? relative(this.modelsDir, modelPath).replace(/\\/g, '/') : null,
      running: this.process !== null,
      healthy: await this.isHealthy()
    }
  }

  /** サーバとモデルが揃っていれば起動する。揃っていなければ理由を投げる */
  async ensureRunning(): Promise<EmbeddingStatus> {
    if (await this.isHealthy()) return this.getStatus()

    const serverPath = resolveLlamaServerPath(this.rootDir)
    if (!serverPath) {
      throw new Error('llama-server が未インストールです（セットアップからインストールしてください）。')
    }
    const modelPath = this.findEmbeddingModel()
    if (!modelPath) {
      throw new Error('models/ に embedding 用 GGUF（例: Qwen3-Embedding-4B）が見つかりません。')
    }

    if (!this.process) {
      this.start(serverPath, modelPath)
    }
    await this.waitForHealthy()
    return this.getStatus()
  }

  /** 起動条件が揃っている場合のみ起動を試みる（アプリ起動時のベストエフォート用） */
  async tryStart(): Promise<void> {
    const serverPath = resolveLlamaServerPath(this.rootDir)
    if (!serverPath || !this.findEmbeddingModel()) return
    try {
      await this.ensureRunning()
    } catch (error) {
      console.error('[embedding] failed to start:', error instanceof Error ? error.message : error)
    }
  }

  async stop(): Promise<void> {
    const proc = this.process
    this.process = null
    if (!proc || proc.killed || proc.exitCode !== null) return

    proc.kill()
    await delay(1_000)
    if (proc.exitCode === null && proc.pid) {
      const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
      await new Promise<void>((resolve) => {
        killer.once('exit', () => resolve())
        killer.once('error', () => resolve())
      })
    }
  }

  private start(serverPath: string, modelPath: string): void {
    const alias = basename(modelPath, '.gguf').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'embedding'
    const args = [
      '--host',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--model',
      modelPath,
      '--alias',
      alias,
      '--embedding',
      '--pooling',
      'last',
      '--ctx-size',
      String(EMBEDDING_CTX_SIZE),
      '--n-gpu-layers',
      '999'
    ]
    this.process = spawn(serverPath, args, {
      cwd: join(serverPath, '..'),
      windowsHide: true
    })
    this.process.stdout.on('data', (data) => process.stdout.write(`[embedding-server] ${data}`))
    this.process.stderr.on('data', (data) => process.stderr.write(`[embedding-server] ${data}`))
    this.process.on('exit', () => {
      this.process = null
    })
  }

  private async waitForHealthy(): Promise<void> {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (await this.isHealthy()) return
      if (!this.process) {
        throw new Error('embedding server process exited before becoming ready.')
      }
      await delay(1_000)
    }
    throw new Error('embedding server did not become ready within 90 seconds.')
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`)
      return response.ok
    } catch {
      return false
    }
  }
}
