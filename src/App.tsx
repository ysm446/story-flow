import { useEffect, useState } from 'react'
import type { AppSettings, BackendStatus, EmbeddingStatus, LlamaServerStatus } from '../electron/main/types'
import { SettingsPanel } from './components/SettingsPanel'
import { SetupPanel } from './components/SetupPanel'
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

  // バックエンドの死活監視
  useEffect(() => {
    let canceled = false
    const check = async () => {
      try {
        await api.health()
        if (!canceled) setBackendHealthy(true)
      } catch {
        if (!canceled) setBackendHealthy(false)
      }
    }
    void check()
    const timer = setInterval(() => void check(), 5_000)
    return () => {
      canceled = true
      clearInterval(timer)
    }
  }, [backendStatus])

  const modelLabel = settings?.isModelLoaded
    ? settings.selectedModelName
    : settings?.isServerInstalled
      ? 'モデル未ロード'
      : 'llama-server 未導入'

  return (
    <div className="flex h-full flex-col">
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
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-dim)]">
            <span
              className={`inline-block h-2 w-2 rounded-full ${backendHealthy ? 'bg-[var(--ok)]' : 'bg-[var(--danger)]'}`}
            />
            backend
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-dim)]">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                settings?.isModelLoaded ? 'bg-[var(--ok)]' : settings?.isServerInstalled ? 'bg-[var(--text-faint)]' : 'bg-[var(--danger)]'
              }`}
            />
            <span className="max-w-[240px] truncate">{modelLabel}</span>
          </span>
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
            className={`rounded border px-2.5 py-1.5 text-[13px] ${
              rightPanel === 'settings'
                ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-strong)] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
            }`}
          >
            ⚙
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
        {rightPanel === 'settings' && <SettingsPanel onClose={() => setRightPanel(null)} />}
      </div>
    </div>
  )
}
