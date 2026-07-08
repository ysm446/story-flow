import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
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
  const rootDir = resolveAppRoot()
  llamaServer = new LlamaServerManager()
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

app.on('window-all-closed', async () => {
  stopResourcePolling?.()
  if (llamaServer) await llamaServer.stop()
  if (embeddingServer) await embeddingServer.stop()
  if (backend) await backend.stop()
  if (process.platform !== 'darwin') app.quit()
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
