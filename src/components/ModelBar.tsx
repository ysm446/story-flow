import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppSettings, ModelOption } from '../../electron/main/types'
import { IconChevronDown, IconCpu, IconEject, IconSpinner } from './icons'

/**
 * ヘッダー中央のモデル選択バー（lm-graph 風）。
 * バーを押すとモデル一覧のモーダルが開き、選ぶとその場でロードする。
 * ロード済みのときはバーの右にイジェクト（停止）ボタンを出す。
 */
export function ModelBar({
  settings,
  busy,
  error,
  onSelect,
  onEject,
  onRescan
}: {
  settings: AppSettings | null
  busy: boolean
  error: string | null
  onSelect: (path: string) => Promise<void> | void
  onEject: () => Promise<void> | void
  onRescan: () => Promise<void> | void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [loadingName, setLoadingName] = useState<string | null>(null)

  const loaded = settings?.isModelLoaded ?? false
  const installed = settings?.isServerInstalled ?? false
  const models = settings?.availableModels ?? []

  const openModal = () => {
    void onRescan()
    setIsOpen(true)
  }

  const selectModel = async (model: ModelOption) => {
    if (busy) return
    setLoadingName(model.name)
    setIsOpen(false)
    try {
      await onSelect(model.path)
    } finally {
      setLoadingName(null)
    }
  }

  const label = busy
    ? `${loadingName ?? settings?.selectedModelName ?? 'モデル'} を読み込み中…`
    : loaded
      ? settings?.selectedModelName ?? 'モデル'
      : installed
        ? 'モデルを選択'
        : 'llama-server 未導入'

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={openModal}
        title={error ?? label}
        className={`flex min-w-[200px] max-w-[360px] items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition ${
          busy
            ? 'animate-pulse border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
            : loaded
              ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text)]'
              : 'border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-dim)] hover:border-[var(--accent-border)] hover:text-[var(--text)]'
        }`}
      >
        <span className="flex w-4 shrink-0 justify-center">
          <IconCpu size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate text-center">{label}</span>
        <span className="flex w-4 shrink-0 justify-center text-[var(--text-faint)]">
          {busy ? <IconSpinner size={14} /> : <IconChevronDown size={13} />}
        </span>
      </button>

      {loaded && !busy && (
        <button
          type="button"
          onClick={() => void onEject()}
          aria-label="モデルを停止"
          title="モデルを停止（VRAM を解放）"
          className="flex items-center rounded-lg border border-[var(--border-strong)] p-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
        >
          <IconEject size={15} />
        </button>
      )}

      {isOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--bg-sidebar)] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">モデルを選択</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
              >
                閉じる
              </button>
            </div>

            <div className="mt-1 max-h-[380px] space-y-1 overflow-y-auto">
              <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                models/ 内のモデル
              </div>
              {models.map((model) => {
                const isActive = loaded && model.path === settings?.selectedModelPath
                const folder = model.name.split(/[\\/]/).slice(0, -1).join('/') || 'models/'
                return (
                  <button
                    key={model.path}
                    onClick={() => void selectModel(model)}
                    disabled={busy}
                    className={`block w-full rounded-lg border px-3 py-2.5 text-left transition disabled:cursor-wait disabled:opacity-60 ${
                      isActive
                        ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text)]'
                        : 'border-transparent text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[13px] font-semibold leading-5">
                          {displayName(model.name)}
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-[var(--text-faint)]">{folder}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-faint)]">
                        {model.metadata.parameterLabel && (
                          <span className="rounded-md bg-[var(--bg-input)] px-2 py-0.5 font-semibold text-[var(--text-dim)]">
                            {model.metadata.parameterLabel}
                          </span>
                        )}
                        {model.metadata.quantizationLabel && (
                          <span className="rounded-md bg-[var(--bg-input)] px-2 py-0.5 font-semibold text-[var(--text-dim)]">
                            {model.metadata.quantizationLabel}
                          </span>
                        )}
                        <span>{formatBytes(model.sizeBytes)}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
              {models.length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-[var(--text-faint)]">
                  {installed
                    ? 'models/ に GGUF がありません'
                    : 'llama-server が未導入です（設定 → セットアップ）'}
                </p>
              )}
            </div>

            {busy && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                <div className="inline-flex items-center gap-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-sidebar)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--text)]">
                  <IconSpinner size={16} />
                  <span>モデルを読み込んでいます…</span>
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-[12px] text-[var(--danger)]">{error}</p>}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

/** パス付きのモデル名からファイル名（末尾）だけを取り出す */
function displayName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name
}

function formatBytes(bytes: number): string {
  if (!bytes) return '--'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`
}
