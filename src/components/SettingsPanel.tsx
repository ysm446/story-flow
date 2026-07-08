import { useUiSettings } from '../store/settings'
import { IconX } from './icons'
import { PromptManager } from './PromptManager'

/**
 * アプリ設定パネル。表示・演出の環境設定とプロンプト管理を置く
 * （サーバ関連はセットアップパネル）。
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useUiSettings()

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[15px] font-semibold">設定</h2>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="rounded px-2 py-1 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
        >
          <IconX size={14} />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <section className="space-y-2">
          <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-dim)]">Generate（生成）</h3>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5">
            <input
              type="checkbox"
              checked={settings.generateIncludeImages}
              onChange={(event) => updateSettings({ generateIncludeImages: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-[13px]">カードの画像を清書に反映</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--text-faint)]">
                清書時にシーンのメディア（サムネイル）を LLM に見せ、写っている情景を描写へ反映します。
                vision 対応モデル（mmproj あり）でのみ有効。生成時間は少し伸びます。
              </span>
            </span>
          </label>
        </section>

        <section className="space-y-2">
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
          <div
            className={`rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 ${
              settings.theaterTextStreaming ? '' : 'opacity-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px]">文字送りの速さ</span>
              <span className="font-mono text-[12px] text-[var(--text-dim)]">
                {settings.theaterTextStreamMsPerChar} ms/字
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={150}
                step={5}
                value={settings.theaterTextStreamMsPerChar}
                disabled={!settings.theaterTextStreaming}
                onChange={(event) => updateSettings({ theaterTextStreamMsPerChar: Number(event.target.value) })}
                className="slider min-w-0 flex-1"
              />
              <button
                onClick={() => updateSettings({ theaterTextStreamMsPerChar: 45 })}
                disabled={!settings.theaterTextStreaming || settings.theaterTextStreamMsPerChar === 45}
                className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
              >
                リセット
              </button>
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-faint)]">
              小さいほど速い。文字送りが終わるまでシーンは送られません
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px]">本文のフォントサイズ</span>
              <span className="font-mono text-[12px] text-[var(--text-dim)]">{settings.theaterFontSizePx} px</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="range"
                min={12}
                max={32}
                step={1}
                value={settings.theaterFontSizePx}
                onChange={(event) => updateSettings({ theaterFontSizePx: Number(event.target.value) })}
                className="slider min-w-0 flex-1"
              />
              <button
                onClick={() => updateSettings({ theaterFontSizePx: 16 })}
                disabled={settings.theaterFontSizePx === 16}
                className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
              >
                リセット
              </button>
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px]">再生ステージのサイズ</span>
              <span className="font-mono text-[12px] text-[var(--text-dim)]">{settings.theaterStageScale}%</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="range"
                min={70}
                max={100}
                step={5}
                value={settings.theaterStageScale}
                onChange={(event) => updateSettings({ theaterStageScale: Number(event.target.value) })}
                className="slider min-w-0 flex-1"
              />
              <button
                onClick={() => updateSettings({ theaterStageScale: 100 })}
                disabled={settings.theaterStageScale === 100}
                className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
              >
                リセット
              </button>
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-faint)]">
              100% 未満では黒背景の中央に額縁表示。没入したいときは再生中の ⛶（全画面）へ
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5">
            <input
              type="checkbox"
              checked={settings.theaterVideoLoopCrossfade}
              onChange={(event) => updateSettings({ theaterVideoLoopCrossfade: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-[13px]">動画ループをクロスディゾルブ</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--text-faint)]">
                動画シーンのループの継ぎ目を、終端と先頭を重ねてフェードで繋ぎます。
                オフにすると通常のループ（カット切替）になります。
              </span>
            </span>
          </label>
          <div
            className={`rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 ${
              settings.theaterVideoLoopCrossfade ? '' : 'opacity-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px]">クロスディゾルブの長さ</span>
              <span className="font-mono text-[12px] text-[var(--text-dim)]">
                {settings.theaterVideoCrossfadeSeconds.toFixed(1)} 秒
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.1}
                value={settings.theaterVideoCrossfadeSeconds}
                disabled={!settings.theaterVideoLoopCrossfade}
                onChange={(event) =>
                  updateSettings({ theaterVideoCrossfadeSeconds: Number(event.target.value) })
                }
                className="slider min-w-0 flex-1"
              />
              <button
                onClick={() => updateSettings({ theaterVideoCrossfadeSeconds: 1.0 })}
                disabled={!settings.theaterVideoLoopCrossfade || settings.theaterVideoCrossfadeSeconds === 1.0}
                className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
              >
                リセット
              </button>
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-faint)]">
              フェードの 2 倍より短い動画は通常ループになります
            </div>
          </div>
        </section>

        <section>
          <PromptManager kind="writer" title="清書プロンプト（物語の種類に合わせて切替）" />
        </section>
      </div>
    </aside>
  )
}
