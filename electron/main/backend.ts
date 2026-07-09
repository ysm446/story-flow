import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { waitForProcessExit } from './llamaServer'
import type { BackendStatus } from './types'

const DEFAULT_BACKEND_PORT = 8600

/**
 * FastAPI バックエンド（backend/main.py）を venv の python で起動・管理する。
 * dev 中に uvicorn を手動起動している場合は、health が通ればそのまま相乗りする。
 */
export class BackendManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private readonly rootDir: string
  private readonly port: number
  private readonly extraEnv: Record<string, string>

  constructor(rootDir: string, extraEnv: Record<string, string> = {}) {
    this.rootDir = rootDir
    this.port = Number(process.env.STORY_FLOW_BACKEND_PORT) || DEFAULT_BACKEND_PORT
    this.extraEnv = extraEnv
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private get pythonPath(): string {
    return join(this.rootDir, '.venv', 'Scripts', 'python.exe')
  }

  async getStatus(): Promise<BackendStatus> {
    return {
      baseUrl: this.baseUrl,
      running: this.process !== null,
      healthy: await this.isHealthy(),
      pythonPath: this.pythonPath,
      venvExists: existsSync(this.pythonPath)
    }
  }

  async ensureRunning(): Promise<BackendStatus> {
    if (await this.isHealthy()) {
      return this.getStatus()
    }
    if (!existsSync(this.pythonPath)) {
      throw new Error('.venv が見つかりません。start.bat を実行して venv をセットアップしてください。')
    }
    if (!this.process) {
      this.start()
    }
    await this.waitForHealthy()
    return this.getStatus()
  }

  private start(): void {
    this.process = spawn(
      this.pythonPath,
      ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(this.port)],
      { cwd: this.rootDir, windowsHide: true, env: { ...process.env, ...this.extraEnv } }
    )
    this.process.stdout.on('data', (data) => process.stdout.write(`[backend] ${data}`))
    this.process.stderr.on('data', (data) => process.stderr.write(`[backend] ${data}`))
    this.process.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`[backend] exited with code ${code}`)
      }
      this.process = null
    })
  }

  async stop(): Promise<void> {
    const proc = this.process
    this.process = null
    if (!proc || proc.killed || proc.exitCode !== null) return

    proc.kill()
    const exited = await waitForProcessExit(proc, 5_000)
    if (exited || !proc.pid) return

    const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
    await new Promise<void>((resolve) => {
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    })
  }

  private async waitForHealthy(): Promise<void> {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (await this.isHealthy()) return
      if (!this.process) {
        throw new Error('FastAPI backend process exited before becoming healthy. Check [backend] logs.')
      }
      await delay(500)
    }
    throw new Error('FastAPI backend did not become ready within 30 seconds.')
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
