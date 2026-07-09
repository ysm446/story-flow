import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { BackendManager } from './backend'
import { EmbeddingServerManager } from './embeddingServer'
import { fetchLlamaReleases, installLlamaVariant } from './llamaInstaller'
import { LlamaServerManager } from './llamaServer'
import { startSystemResourcePolling } from './systemResources'
import type { BootstrapPayload, LlamaInstallProgress, LlamaReleaseVariant } from './types'

let llamaServer: LlamaServerManager | null = null
let embeddingServer: EmbeddingServerManager | null = null
let backend: BackendManager | null = null
let llamaInstallController: AbortController | null = null
let stopResourcePolling: (() => void) | null = null
let uiSettingsPath: string | null = null

// 二重起動の禁止。2 つ目のインスタンスは llama / embedding をもう 1 セット起動して
// VRAM を消費し、片方を閉じると共有 backend が落ちるため。孤児プロセス回収の前提でもある
// （lock を持っている限り、runtime/ 配下の llama-server.exe の持ち主は自分以外にいない）
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) {
    if (window.isMinimized()) window.restore()
    window.focus()
  }
})

/**
 * 前回の異常終了（クラッシュ・強制終了・シャットダウン）で残った llama-server.exe を回収する。
 * Windows は親プロセスが死んでも子が終了しないため、残った孤児がポートを塞ぎ、
 * 次回起動でサーバが増殖して VRAM を二重消費する。
 * 実行パスが runtime/ 配下のプロセスだけを対象にする（ユーザーが別途動かしている
 * llama-server には触れない）。single instance lock 取得後に呼ぶこと。
 */
async function killOrphanLlamaServers(runtimeDir: string): Promise<void> {
  if (process.platform !== 'win32') return
  const dir = runtimeDir.replace(/'/g, "''")
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | ` +
    `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', [System.StringComparison]::OrdinalIgnoreCase) } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
  await new Promise<void>((done) => {
    const killer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true
    })
    const timer = setTimeout(() => {
      killer.kill()
      done()
    }, 10_000)
    killer.once('exit', () => {
      clearTimeout(timer)
      done()
    })
    killer.once('error', () => {
      clearTimeout(timer)
      done()
    })
  })
}

function getLlamaServer(): LlamaServerManager {
  if (!llamaServer) throw new Error('Llama server manager is not initialized yet.')
  return llamaServer
}

function getEmbeddingServer(): EmbeddingServerManager {
  if (!embeddingServer) throw new Error('Embedding server manager is not initialized yet.')
  return embeddingServer
}

function getBackend(): BackendManager {
  if (!backend) throw new Error('Backend manager is not initialized yet.')
  return backend
}

function resolveAppRoot(): string {
  const candidates = [
    process.cwd(),
    resolve(app.getAppPath(), '..', '..'),
    app.getAppPath()
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'backend')) || existsSync(join(candidate, 'models'))) {
      return candidate
    }
  }
  return process.cwd()
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    useContentSize: true,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#0d0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  window.setMenuBarVisibility(false)
  window.webContents.on('console-message', (details) => {
    console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedUrl}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:gone] ${details.reason} exitCode=${details.exitCode}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  const rootDir = resolveAppRoot()
  uiSettingsPath = join(rootDir, 'data', 'settings.json')
  llamaServer = new LlamaServerManager()
  // 孤児の回収はポート探索（embeddingServer.init）より前に行う。
  // 残存プロセスがポートを塞いだままだと探索結果がずれて増殖の起点になる
  await killOrphanLlamaServers(llamaServer.getRuntimeDir())
  embeddingServer = new EmbeddingServerManager(rootDir)
  // 埋め込みサーバのポートを確定させてからバックエンドに URL を注入する
  await embeddingServer.init()
  backend = new BackendManager(rootDir, { STORY_FLOW_EMBEDDING_URL: embeddingServer.baseUrl })
  registerIpc()
  createWindow()
  stopResourcePolling = startSystemResourcePolling()

  // バックエンド・埋め込みサーバは起動を待たずに立ち上げ始める
  void backend.ensureRunning().catch((error) => {
    console.error('[backend] failed to start:', error instanceof Error ? error.message : error)
  })
  void embeddingServer.tryStart()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 終了時の子プロセス後始末。window-all-closed 以外の終了経路（app.quit() や
// OS からの終了要求）でも必ず一度だけ通るよう will-quit にもフックする
let childrenShutDown = false
async function shutdownChildren(): Promise<void> {
  if (childrenShutDown) return
  childrenShutDown = true
  stopResourcePolling?.()
  await Promise.allSettled([llamaServer?.stop(), embeddingServer?.stop(), backend?.stop()])
}

app.on('window-all-closed', async () => {
  await shutdownChildren()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', (event) => {
  if (childrenShutDown) return
  event.preventDefault()
  void shutdownChildren().finally(() => app.quit())
})

function registerIpc(): void {
  const llama = getLlamaServer()
  const embedding = getEmbeddingServer()
  const backendManager = getBackend()

  ipcMain.handle('bootstrap', async (): Promise<BootstrapPayload> => {
    return {
      backend: await backendManager.getStatus(),
      settings: await llama.getRuntimeSettings(),
      llamaStatus: llama.getServerStatus(),
      embedding: await embedding.getStatus()
    }
  })

  ipcMain.handle('backend:status', async () => backendManager.getStatus())
  ipcMain.handle('backend:ensure', async () => backendManager.ensureRunning())

  // ライブラリの新規作成/切り替え用のフォルダ選択
  ipcMain.handle('dialog:pickFolder', async (event, title?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: title ?? 'フォルダを選択',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // UI 設定は data/settings.json に保存する
  ipcMain.handle('uiSettings:load', async () => {
    if (!uiSettingsPath) return {}
    try {
      return JSON.parse(await readFile(uiSettingsPath, 'utf-8')) as Record<string, unknown>
    } catch {
      return {}
    }
  })
  ipcMain.handle('uiSettings:save', async (_event, settings: Record<string, unknown>) => {
    if (!uiSettingsPath) return { ok: false as const }
    await mkdir(join(uiSettingsPath, '..'), { recursive: true })
    await writeFile(uiSettingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    return { ok: true as const }
  })

  // Theater の全画面再生用
  ipcMain.handle('window:setFullScreen', (event, value: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.setFullScreen(value)
    return window?.isFullScreen() ?? false
  })
  ipcMain.handle('window:toggleFullScreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    window.setFullScreen(!window.isFullScreen())
    return window.isFullScreen()
  })

  ipcMain.handle('embedding:status', async () => embedding.getStatus())
  ipcMain.handle('embedding:ensure', async () => embedding.ensureRunning())
  ipcMain.handle('embedding:stop', async () => {
    await embedding.stop()
    return embedding.getStatus()
  })

  ipcMain.handle('models:list', async () => llama.getRuntimeSettings())
  ipcMain.handle('models:rescan', async () => llama.rescan())
  ipcMain.handle('models:select', async (_event, modelPath: string) => {
    await llama.selectModel(modelPath)
    return { settings: await llama.getRuntimeSettings() }
  })
  ipcMain.handle('models:eject', async () => {
    await llama.stop()
    return { settings: await llama.getRuntimeSettings() }
  })
  ipcMain.handle('llama:ensure', async () => {
    const settings = await llama.ensureRunning()
    return { settings }
  })

  ipcMain.handle('llama:status', async () => llama.getServerStatus())
  ipcMain.handle('llama:releases', async () => fetchLlamaReleases())
  ipcMain.handle('llama:install', async (event, variant: LlamaReleaseVariant) => {
    if (llamaInstallController) {
      throw new Error('An installation is already in progress.')
    }
    const controller = new AbortController()
    llamaInstallController = controller
    const onProgress = (progress: LlamaInstallProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send('llama:install-progress', progress)
    }
    try {
      await installLlamaVariant({ runtimeDir: llama.getRuntimeDir(), variant, onProgress, signal: controller.signal })
      const settings = await llama.rescan()
      return { ok: true as const, settings, status: llama.getServerStatus() }
    } catch (error) {
      const aborted = controller.signal.aborted || (error as Error)?.name === 'AbortError'
      onProgress(aborted ? { phase: 'canceled' } : { phase: 'error', message: error instanceof Error ? error.message : String(error) })
      return { ok: false as const, canceled: aborted, message: error instanceof Error ? error.message : String(error) }
    } finally {
      llamaInstallController = null
    }
  })
  ipcMain.handle('llama:install-cancel', async () => {
    llamaInstallController?.abort()
    return { ok: true as const }
  })
}
