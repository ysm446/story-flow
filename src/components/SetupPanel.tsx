import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettings,
  EmbeddingStatus,
  LlamaInstallProgress,
  LlamaRelease,
  LlamaReleaseVariant,
  LlamaServerStatus
} from '../../electron/main/types'

interface SetupPanelProps {
  settings: AppSettings | null
  llamaStatus: LlamaServerStatus | null
  embedding: EmbeddingStatus | null
  onSettingsChange: (settings: AppSettings) => void
  onLlamaStatusChange: (status: LlamaServerStatus) => void
  onEmbeddingChange: (status: EmbeddingStatus) => void
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

export function SetupPanel({
  settings,
  llamaStatus,
  embedding,
  onSettingsChange,
  onLlamaStatusChange,
  onEmbeddingChange,
  onClose
}: SetupPanelProps) {
  const [embeddingBusy, setEmbeddingBusy] = useState(false)
  const [releases, setReleases] = useState<LlamaRelease[]>([])
  const [selectedVariantKey, setSelectedVariantKey] = useState<string | null>(null)
  const [loadingReleases, setLoadingReleases] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<LlamaInstallProgress | null>(null)
  const [busyModelPath, setBusyModelPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const installed = llamaStatus?.installed ?? false

  useEffect(() => {
    return window.storyFlow.onLlamaInstallProgress((payload) => setProgress(payload))
  }, [])

  const loadReleases = useCallback(async () => {
    setLoadingReleases(true)
    setError(null)
    try {
      const fetched = await window.storyFlow.fetchLlamaReleases()
      setReleases(fetched)
      const firstVariant = fetched[0]?.variants[0]
      if (firstVariant) setSelectedVariantKey(firstVariant.key)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingReleases(false)
    }
  }, [])

  useEffect(() => {
    if (!installed && releases.length === 0 && !loadingReleases) {
      void loadReleases()
    }
    // 未インストール時に一度だけ自動取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed])

  const selectedVariant: LlamaReleaseVariant | null =
    releases.flatMap((release) => release.variants).find((variant) => variant.key === selectedVariantKey) ?? null

  const handleInstall = async () => {
    if (!selectedVariant) return
    setInstalling(true)
    setError(null)
    setProgress(null)
    try {
      const result = await window.storyFlow.installLlamaServer(selectedVariant)
      if (result.ok) {
        onSettingsChange(result.settings)
        onLlamaStatusChange(result.status)
      } else if (!result.canceled) {
        setError(result.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setInstalling(false)
    }
  }

  const handleSelectModel = async (modelPath: string) => {
    setBusyModelPath(modelPath)
    setError(null)
    try {
      const { settings: next } = await window.storyFlow.selectModel(modelPath)
      onSettingsChange(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyModelPath(null)
    }
  }

  const handleEject = async () => {
    setError(null)
    try {
      const { settings: next } = await window.storyFlow.ejectModel()
      onSettingsChange(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[15px] font-semibold">セットアップ</h2>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="rounded px-2 py-1 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {/* llama-server インストール状態 */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-dim)]">llama-server</h3>
          {installed ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--ok)]" />
                <span>インストール済み{llamaStatus?.build ? `（${llamaStatus.build}）` : ''}</span>
              </div>
              <div className="mt-1 break-all font-mono text-[12px] text-[var(--text-faint)]">{llamaStatus?.installDir}</div>
            </div>
          ) : (
            <div className="rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[13px]">
              llama-server が未インストールです。下からバックエンドを選んでインストールしてください。
            </div>
          )}

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--text-dim)]">利用可能なビルド</span>
              <button
                onClick={() => void loadReleases()}
                disabled={loadingReleases || installing}
                className="rounded border border-[var(--border-strong)] px-2 py-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingReleases ? '取得中…' : '再取得'}
              </button>
            </div>

            {releases.length > 0 && (
              <>
                <select
                  value={selectedVariantKey ?? ''}
                  onChange={(event) => setSelectedVariantKey(event.target.value)}
                  disabled={installing}
                  className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-2 text-[13px]"
                >
                  {releases.slice(0, 3).map((release) =>
                    release.variants.map((variant) => (
                      <option key={variant.key} value={variant.key}>
                        {release.tag} — {variant.label}（{formatBytes(variant.sizeBytes)}）
                      </option>
                    ))
                  )}
                </select>
                <button
                  onClick={() => void handleInstall()}
                  disabled={!selectedVariant || installing}
                  className="w-full rounded bg-[var(--accent)] px-3 py-2 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {installing ? 'インストール中…' : installed ? '別ビルドをインストール' : 'インストール'}
                </button>
                {installing && (
                  <button
                    onClick={() => void window.storyFlow.cancelLlamaInstall()}
                    className="w-full rounded border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
                  >
                    キャンセル
                  </button>
                )}
              </>
            )}

            {progress && progress.phase === 'download' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[12px] text-[var(--text-dim)]">
                  <span>{progress.fileLabel} をダウンロード中</span>
                  <span>{progress.percent !== null ? `${progress.percent}%` : formatBytes(progress.received)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-[var(--bg-input)]">
                  <div
                    className="h-full rounded bg-[var(--accent)] transition-[width]"
                    style={{ width: `${progress.percent ?? 0}%` }}
                  />
                </div>
              </div>
            )}
            {progress && progress.phase === 'extract' && (
              <div className="text-[12px] text-[var(--text-dim)]">{progress.fileLabel} を展開中…</div>
            )}
            {progress && progress.phase === 'done' && (
              <div className="text-[12px] text-[var(--ok)]">インストール完了（{progress.build ?? 'unknown build'}）</div>
            )}
            {progress && progress.phase === 'canceled' && (
              <div className="text-[12px] text-[var(--text-dim)]">キャンセルしました</div>
            )}
          </div>
        </section>

        {/* モデル選択 */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-dim)]">
            生成モデル（models/ 配下の GGUF）
          </h3>
          {settings && settings.availableModels.length > 0 ? (
            <ul className="space-y-2">
              {settings.availableModels.map((model) => {
                const isSelected = model.path === settings.selectedModelPath
                const isLoaded = isSelected && settings.isModelLoaded
                return (
                  <li
                    key={model.path}
                    className={`rounded-md border px-3 py-2 text-[13px] ${
                      isSelected ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--bg-card)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-all">{model.name}</span>
                      {isLoaded && <span className="shrink-0 text-[11px] text-[var(--ok)]">起動中</span>}
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[12px] text-[var(--text-faint)]">
                        {formatBytes(model.sizeBytes)}
                        {model.metadata.quantizationLabel ? ` ・ ${model.metadata.quantizationLabel}` : ''}
                        {settings.supportsVision && isSelected ? ' ・ vision' : ''}
                      </span>
                      {isLoaded ? (
                        <button
                          onClick={() => void handleEject()}
                          className="rounded border border-[var(--border-strong)] px-2 py-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
                        >
                          停止
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleSelectModel(model.path)}
                          disabled={!installed || busyModelPath !== null}
                          className="rounded bg-[var(--accent)] px-2 py-1 text-[12px] text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyModelPath === model.path ? '起動中…' : 'ロード'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[13px] text-[var(--text-dim)]">
              models/ に GGUF ファイルが見つかりません。
            </div>
          )}
        </section>

        {/* 埋め込みサーバ（Vault の検索・類似判定用） */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-dim)]">
            埋め込みサーバ（Vault の検索用）
          </h3>
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[13px]">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  embedding?.healthy ? 'bg-[var(--ok)]' : 'bg-[var(--text-faint)]'
                }`}
              />
              <span>{embedding?.healthy ? '起動中' : '停止中'}</span>
            </div>
            <div className="mt-1 break-all text-[12px] text-[var(--text-faint)]">
              {embedding?.modelName ?? 'models/ に embedding 用 GGUF（例: Qwen3-Embedding-4B）が見つかりません'}
            </div>
            <div className="mt-2 flex gap-2">
              {embedding?.healthy ? (
                <button
                  onClick={async () => {
                    setEmbeddingBusy(true)
                    try {
                      onEmbeddingChange(await window.storyFlow.stopEmbedding())
                    } finally {
                      setEmbeddingBusy(false)
                    }
                  }}
                  disabled={embeddingBusy}
                  className="rounded border border-[var(--border-strong)] px-2 py-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={async () => {
                    setEmbeddingBusy(true)
                    setError(null)
                    try {
                      onEmbeddingChange(await window.storyFlow.ensureEmbedding())
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause))
                    } finally {
                      setEmbeddingBusy(false)
                    }
                  }}
                  disabled={embeddingBusy || !embedding?.serverInstalled || !embedding?.modelPath}
                  className="rounded bg-[var(--accent)] px-2 py-1 text-[12px] text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {embeddingBusy ? '起動中…' : '起動'}
                </button>
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-md border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[13px] text-[var(--danger)]">
            {error}
          </div>
        )}
      </div>
    </aside>
  )
}
