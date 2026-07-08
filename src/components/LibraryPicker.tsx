import { useState } from 'react'
import { api } from '../lib/api'

/**
 * ライブラリ（作品バンドルフォルダ）の新規作成 / 開く。
 * ライブラリ未オープン時は起動直後にモーダルとして表示され、切り替え時にも使う。
 */
export function LibraryPicker({
  currentRoot,
  onOpened,
  onClose
}: {
  currentRoot: string | null
  onOpened: () => void
  onClose: (() => void) | null // null = 閉じられない（未オープン時）
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePick = async (mode: 'open' | 'create') => {
    setError(null)
    const path = await window.storyFlow.pickFolder(
      mode === 'create' ? '新しいライブラリを作るフォルダを選択' : 'ライブラリフォルダを選択'
    )
    if (!path) return
    setBusy(true)
    try {
      await api.openLibrary(path, mode)
      onOpened()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[460px] rounded-md border border-[var(--border-strong)] bg-[var(--bg-sidebar)] p-5">
        <h2 className="text-[16px] font-semibold">ライブラリ</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-dim)]">
          ライブラリは素材（カード）・作品・生成結果・プロンプトをまとめた 1 つのフォルダです。
          フォルダごとコピーしてバックアップ・共有できます。
        </p>
        {currentRoot && (
          <p className="mt-2 break-all rounded bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-faint)]">
            現在: {currentRoot}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => void handlePick('create')}
            disabled={busy}
            className="rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-4 text-left hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            <span className="block text-[14px] font-medium">新規作成</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-[var(--text-dim)]">
              空のフォルダを選んで、新しいライブラリを作る
            </span>
          </button>
          <button
            onClick={() => void handlePick('open')}
            disabled={busy}
            className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-4 py-4 text-left hover:bg-[var(--bg-elevated)] disabled:opacity-50"
          >
            <span className="block text-[14px] font-medium">ライブラリを開く</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-[var(--text-dim)]">
              既存のライブラリフォルダを選んで開く
            </span>
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[12px] text-[var(--danger)]">
            {error}
          </div>
        )}

        {onClose && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[13px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
