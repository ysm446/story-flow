import { useUiSettings } from '../store/settings'

/**
 * アプリ設定パネル。表示・演出の環境設定を置く（サーバ関連はセットアップパネル）。
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useUiSettings()

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[15px] font-semibold">設定</h2>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="rounded px-2 py-1 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-dim)]">Theater（鑑賞）</h3>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5">
            <input
              type="checkbox"
              checked={settings.theaterTextStreaming}
              onChange={(event) => updateSettings({ theaterTextStreaming: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-[13px]">本文をストリーミング表示</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--text-faint)]">
                再生時に本文を 1 文字ずつ流すタイプライター演出。オフにすると全文を一度に表示します。
              </span>
            </span>
          </label>
        </section>
      </div>
    </aside>
  )
}
