import { useEffect, useState } from 'react'
import type { AppSettings, BackendStatus, EmbeddingStatus, LlamaServerStatus } from '../electron/main/types'
import { IconFolder, IconPlay, IconSettings, IconX } from './components/icons'
import { LibraryPicker } from './components/LibraryPicker'
import { SettingsPanel } from './components/SettingsPanel'
import { SetupPanel } from './components/SetupPanel'
import { StatusBar } from './components/StatusBar'
import { api, configureApi } from './lib/api'
import { ComposePhase } from './phases/compose/ComposePhase'
import { GeneratePhase } from './phases/generate/GeneratePhase'
import { TheaterPhase } from './phases/theater/TheaterPhase'
import { VaultPhase } from './phases/vault/VaultPhase'
import { AppStoreProvider, useAppStore, type PhaseId } from './store/appStore'
import { SettingsProvider } from './store/settings'

const PHASES: Array<{ id: PhaseId; label: string }> = [
  { id: 'vault', label: 'Vault' },
  { id: 'compose', label: 'Compose' },
  { id: 'generate', label: 'Generate' },
  { id: 'theater', label: 'Theater' }
]

export default function App() {
  return (
    <AppStoreProvider>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </AppStoreProvider>
  )
}

type RightPanel = 'setup' | 'settings' | null

function AppShell() {
  const { phase, setPhase } = useAppStore()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [llamaStatus, setLlamaStatus] = useState<LlamaServerStatus | null>(null)
  const [embedding, setEmbedding] = useState<EmbeddingStatus | null>(null)
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null)
  const [backendHealthy, setBackendHealthy] = useState(false)
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null)
  const [libraryChecked, setLibraryChecked] = useState(false)
  const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false)
  const [modelBusy, setModelBusy] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  // ヘッダーのモデルバー操作
  const handleSelectModel = async (modelPath: string) => {
    if (!modelPath || modelBusy) return
    setModelBusy(true)
    setModelError(null)
    try {
      const { settings: next } = await window.storyFlow.selectModel(modelPath)
      setSettings(next)
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setModelBusy(false)
    }
  }

  const handleLoadModel = async () => {
    setModelBusy(true)
    setModelError(null)
    try {
      const { settings: next } = await window.storyFlow.ensureLlama()
      setSettings(next)
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setModelBusy(false)
    }
  }

  const handleEjectModel = async () => {
    setModelBusy(true)
    try {
      const { settings: next } = await window.storyFlow.ejectModel()
      setSettings(next)
    } finally {
      setModelBusy(false)
    }
  }

  const handleRescanModels = async () => {
    try {
      setSettings(await window.storyFlow.rescanModels())
    } catch {
      // 再スキャン失敗は無視（既存リストのまま）
    }
  }

  // 初期化: Electron main から設定を取得し、API クライアントを構成する
  useEffect(() => {
    let canceled = false
    void window.storyFlow.bootstrap().then((payload) => {
      if (canceled) return
      configureApi(payload.backend.baseUrl)
      setBackendStatus(payload.backend)
      setSettings(payload.settings)
      setLlamaStatus(payload.llamaStatus)
      setEmbedding(payload.embedding)
      // llama-server 未インストールなら初回からセットアップを開く
      if (!payload.llamaStatus.installed) setRightPanel('setup')
    })
    return () => {
      canceled = true
    }
  }, [])

  // ウィンドウへのファイルドロップの既定動作（ファイルへのナビゲーション）を防止。
  // 個別のドロップ対応（Vault など）は各コンポーネント側で preventDefault + 処理する
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // バックエンドの死活監視 + ライブラリ状態の取得
  useEffect(() => {
    let canceled = false
    const check = async () => {
      try {
        await api.health()
        if (canceled) return
        setBackendHealthy(true)
      } catch {
        if (!canceled) setBackendHealthy(false)
        return
      }
      // ライブラリ状態は死活とは独立に確認する（失敗してもピッカーは手動で開ける）
      if (!libraryChecked) {
        try {
          const library = await api.getLibrary()
          if (canceled) return
          setLibraryRoot(library.root)
          setLibraryChecked(true)
          if (!library.open) setIsLibraryPickerOpen(true)
        } catch {
          // 旧バックエンド稼働中など。次の周期で再試行
        }
      }
    }
    void check()
    const timer = setInterval(() => void check(), 5_000)
    return () => {
      canceled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendStatus, libraryChecked])

  const modelLabel = settings?.isModelLoaded
    ? settings.selectedModelName
    : settings?.isServerInstalled
      ? 'モデル未ロード'
      : 'llama-server 未導入'

  // ライブラリのフォルダ名（末尾）を表示用に
  const libraryName = libraryRoot ? (libraryRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? libraryRoot) : null

  return (
    <div className="relative flex h-full flex-col">
      {isLibraryPickerOpen && (
        <LibraryPicker
          currentRoot={libraryRoot}
          onOpened={() => window.location.reload()}
          onClose={libraryChecked && !libraryRoot ? null : () => setIsLibraryPickerOpen(false)}
        />
      )}

      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[var(--bg-sidebar)] px-4">
        <span className="text-[15px] font-semibold tracking-wide">Story Flow</span>

        <nav className="flex items-center gap-1">
          {PHASES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPhase(id)}
              className={`rounded px-3 py-1.5 text-[13px] ${
                phase === id
                  ? 'bg-[var(--accent-soft)] text-[var(--text)] outline outline-1 outline-[var(--accent-border)]'
                  : 'text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setIsLibraryPickerOpen(true)}
            title={libraryRoot ? `ライブラリ: ${libraryRoot}（クリックで切り替え）` : 'ライブラリを開く'}
            className="flex max-w-[220px] items-center gap-1.5 rounded border border-[var(--border-strong)] px-2.5 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
          >
            <IconFolder size={13} />
            <span className="truncate">{libraryName ?? 'ライブラリを開く'}</span>
          </button>
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-dim)]">
            <span
              className={`inline-block h-2 w-2 rounded-full ${backendHealthy ? 'bg-[var(--ok)]' : 'bg-[var(--danger)]'}`}
            />
            backend
          </span>
          {/* モデル選択バー: models/ の GGUF から選択（選択でロード） */}
          <div className="flex items-center gap-1.5" title={modelError ?? modelLabel}>
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                modelBusy
                  ? 'animate-pulse bg-[var(--accent)]'
                  : settings?.isModelLoaded
                    ? 'bg-[var(--ok)]'
                    : settings?.isServerInstalled
                      ? 'bg-[var(--text-faint)]'
                      : 'bg-[var(--danger)]'
              }`}
            />
            <select
              value={settings?.selectedModelPath ?? ''}
              onChange={(event) => void handleSelectModel(event.target.value)}
              onFocus={() => void handleRescanModels()}
              disabled={modelBusy || !settings?.isServerInstalled || (settings?.availableModels.length ?? 0) === 0}
              className="max-w-[260px] rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[12px] disabled:opacity-60"
            >
              {(settings?.availableModels.length ?? 0) === 0 && <option value="">モデルなし（models/ に GGUF を配置）</option>}
              {settings?.availableModels.map((model) => (
                <option key={model.path} value={model.path}>
                  {model.name}
                  {model.metadata.quantizationLabel ? `（${model.metadata.quantizationLabel}）` : ''}
                </option>
              ))}
            </select>
            {modelBusy ? (
              <span className="text-[11px] text-[var(--accent)]">ロード中…</span>
            ) : settings?.isModelLoaded ? (
              <button
                onClick={() => void handleEjectModel()}
                aria-label="モデルを停止"
                title="モデルを停止（VRAM を解放）"
                className="flex items-center rounded border border-[var(--border-strong)] px-1.5 py-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
              >
                <IconX size={11} />
              </button>
            ) : (
              <button
                onClick={() => void handleLoadModel()}
                disabled={!settings?.isServerInstalled || !settings?.selectedModelPath}
                aria-label="モデルをロード"
                title="選択中のモデルをロード"
                className="flex items-center rounded border border-[var(--border-strong)] px-1.5 py-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
              >
                <IconPlay size={11} />
              </button>
            )}
          </div>
          <button
            onClick={() => setRightPanel((panel) => (panel === 'setup' ? null : 'setup'))}
            className={`rounded border px-3 py-1.5 text-[13px] ${
              rightPanel === 'setup'
                ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-strong)] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
            }`}
          >
            セットアップ
          </button>
          <button
            onClick={() => setRightPanel((panel) => (panel === 'settings' ? null : 'settings'))}
            aria-label="設定"
            title="設定"
            className={`flex items-center rounded border px-2.5 py-1.5 ${
              rightPanel === 'settings'
                ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-strong)] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
            }`}
          >
            <IconSettings size={15} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--bg)]">
          {phase === 'vault' && <VaultPhase />}
          {phase === 'compose' && <ComposePhase />}
          {phase === 'generate' && <GeneratePhase />}
          {phase === 'theater' && <TheaterPhase />}
        </main>

        {rightPanel === 'setup' && (
          <SetupPanel
            settings={settings}
            llamaStatus={llamaStatus}
            embedding={embedding}
            onSettingsChange={setSettings}
            onLlamaStatusChange={setLlamaStatus}
            onEmbeddingChange={setEmbedding}
            onClose={() => setRightPanel(null)}
          />
        )}
        {rightPanel === 'settings' && (
          <SettingsPanel
            onClose={() => setRightPanel(null)}
            libraryRoot={libraryRoot}
            onOpenLibraryPicker={() => setIsLibraryPickerOpen(true)}
          />
        )}
      </div>

      <StatusBar backendHealthy={backendHealthy} modelLabel={modelLabel} />
    </div>
  )
}
