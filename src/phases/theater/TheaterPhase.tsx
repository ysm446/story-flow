import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, cardFileUrl, type Card, type StoryDetail, type StorySummary } from '../../lib/api'
import { useUiSettings } from '../../store/settings'

// 本文ストリーミング（タイプライター演出）の 1 文字あたりの間隔
const STREAM_INTERVAL_MS = 45

const TONE_LABELS: Record<string, string> = {
  happy: 'ハッピー',
  bad: 'バッド',
  bitter: 'ビター',
  neutral: 'ニュートラル'
}

// オート送り: 基本 4 秒 + 文字数 × 90ms（5〜30 秒にクランプ）
function sceneDurationMs(prose: string): number {
  return Math.min(30_000, Math.max(5_000, 4_000 + prose.length * 90))
}

/**
 * Theater: 生成済み story の鑑賞。
 * Ken Burns（パン/ズーム）+ テキスト長に応じたオート送り + クロスフェード。
 */
export function TheaterPhase() {
  const [stories, setStories] = useState<StorySummary[]>([])
  const [playing, setPlaying] = useState<{ story: StoryDetail; cards: Map<string, Card> } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStories = useCallback(async () => {
    try {
      const result = await api.listStories()
      setStories(result.stories)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void loadStories()
  }, [loadStories])

  const handlePlay = async (storyId: string) => {
    setLoadingId(storyId)
    setError(null)
    try {
      const story = await api.getStory(storyId)
      const cards = new Map<string, Card>()
      for (const scene of story.scenes) {
        if (!cards.has(scene.card_id)) {
          try {
            cards.set(scene.card_id, await api.getCard(scene.card_id))
          } catch {
            // カードが削除済みでも再生は続行（背景なしになるだけ）
          }
        }
      }
      setPlaying({ story, cards })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingId(null)
    }
  }

  const handleDelete = async (story: StorySummary) => {
    if (!window.confirm('この物語を削除しますか？')) return
    try {
      await api.deleteStory(story.id)
      void loadStories()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (playing) {
    return <StoryPlayer story={playing.story} cards={playing.cards} onExit={() => setPlaying(null)} />
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-[18px] font-semibold">Theater — 鑑賞</h1>
      <p className="mt-1 text-[13px] text-[var(--text-dim)]">
        生成した物語を再生します。スペースで一時停止、← → でシーン移動、Esc で終了。
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[13px] text-[var(--danger)]">
          {error}
        </div>
      )}

      {stories.length === 0 && !error ? (
        <div className="mt-16 text-center text-[13px] text-[var(--text-faint)]">
          まだ物語がありません。Generate フェーズで生成してください。
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {stories.map((story) => (
            <li
              key={story.id}
              className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{story.plot || '（プロットなし）'}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--text-faint)]">
                  <span>{new Date(story.created_at).toLocaleString('ja-JP')}</span>
                  {story.target_tone && (
                    <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px]">
                      {TONE_LABELS[story.target_tone] ?? story.target_tone}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => void handlePlay(story.id)}
                disabled={loadingId !== null}
                className="shrink-0 rounded bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {loadingId === story.id ? '読み込み中…' : '▶ 再生'}
              </button>
              <button
                onClick={() => void handleDelete(story)}
                disabled={loadingId !== null}
                aria-label="削除"
                className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-1.5 text-[13px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StoryPlayer({
  story,
  cards,
  onExit
}: {
  story: StoryDetail
  cards: Map<string, Card>
  onExit: () => void
}) {
  const scenes = useMemo(() => [...story.scenes].sort((a, b) => a.position - b.position), [story.scenes])
  const { settings: uiSettings } = useUiSettings()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [finished, setFinished] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [visibleChars, setVisibleChars] = useState(0)

  const scene = scenes[index]
  const isStreaming = uiSettings.theaterTextStreaming

  // 本文ストリーミング: シーン切替でリセットし、1 文字ずつ増やす（一時停止で止まる）
  useEffect(() => {
    setVisibleChars(0)
  }, [index])

  useEffect(() => {
    if (!isStreaming || paused || finished || !scene) return
    if (visibleChars >= scene.prose.length) return
    const timer = setInterval(() => {
      setVisibleChars((prev) => Math.min(prev + 1, scene.prose.length))
    }, STREAM_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [isStreaming, paused, finished, scene, visibleChars >= (scene?.prose.length ?? 0)])

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return
      if (next >= scenes.length) {
        setFinished(true)
        setPaused(true)
        return
      }
      setFinished(false)
      setIndex(next)
    },
    [scenes.length]
  )

  // オート送り
  useEffect(() => {
    if (paused || finished || !scene) return
    const timer = setTimeout(() => goTo(index + 1), sceneDurationMs(scene.prose))
    return () => clearTimeout(timer)
  }, [index, paused, finished, scene, goTo])

  // キーボード操作
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
      else if (event.key === ' ') {
        event.preventDefault()
        setPaused((prev) => !prev)
      } else if (event.key === 'ArrowRight') goTo(index + 1)
      else if (event.key === 'ArrowLeft') goTo(index - 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, goTo, onExit])

  // マウスが止まったらコントロールを隠す
  useEffect(() => {
    if (!controlsVisible) return
    const timer = setTimeout(() => setControlsVisible(false), 3_000)
    return () => clearTimeout(timer)
  }, [controlsVisible, index])

  return (
    <div
      className="relative h-full overflow-hidden bg-black"
      onMouseMove={() => setControlsVisible(true)}
      onClick={() => setPaused((prev) => !prev)}
    >
      {/* シーンレイヤー（クロスフェード） */}
      {scenes.map((item, i) => {
        const card = cards.get(item.card_id)
        const isActive = i === index && !finished
        return (
          <div key={item.id} className={`theater-layer ${isActive ? 'is-active' : ''}`}>
            {card?.media_path ? (
              card.media_type === 'video' ? (
                isActive && (
                  <video
                    src={cardFileUrl(card.id, false)}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-full w-full object-cover"
                  />
                )
              ) : (
                <img
                  src={cardFileUrl(card.id, false)}
                  alt=""
                  className={`h-full w-full object-cover ${isActive ? `kenburns-${i % 4}` : ''}`}
                />
              )
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-[#1a1d2e] to-[#0d0f14]" />
            )}
            {/* テキストの可読性のためのグラデーション */}
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 to-transparent" />
          </div>
        )
      })}

      {/* 本文（ストリーミング時は全文で高さを確保し、上に可視分を重ねてレイアウトのずれを防ぐ） */}
      {!finished && scene && (
        <div key={scene.id} className="absolute inset-x-0 bottom-0 px-10 pb-14 pt-6">
          <p className="relative mx-auto max-w-2xl whitespace-pre-wrap text-[16px] leading-[2] text-white/95 [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">
            <span className="invisible">{scene.prose}</span>
            <span className="absolute inset-0 whitespace-pre-wrap">
              {isStreaming ? scene.prose.slice(0, visibleChars) : scene.prose}
            </span>
          </p>
        </div>
      )}

      {/* 終了画面 */}
      {finished && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/70">
          <div className="text-[22px] tracking-[0.5em] text-white/90">終</div>
          <div className="flex gap-3">
            <button
              onClick={(event) => {
                event.stopPropagation()
                setFinished(false)
                setIndex(0)
                setPaused(false)
              }}
              className="rounded bg-[var(--accent)] px-4 py-2 text-[13px] text-white hover:bg-[var(--accent-hover)]"
            >
              もう一度
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                onExit()
              }}
              className="rounded border border-white/30 px-4 py-2 text-[13px] text-white/80 hover:bg-white/10"
            >
              一覧へ戻る
            </button>
          </div>
        </div>
      )}

      {/* コントロール */}
      <div
        className={`absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 transition-opacity ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-[12px] text-white/70">
          {index + 1} / {scenes.length}
          {paused && !finished && ' ・ 一時停止中'}
        </span>
        <button
          onClick={onExit}
          aria-label="終了"
          className="rounded bg-black/40 px-2.5 py-1 text-[14px] text-white/80 hover:bg-black/60"
        >
          ✕
        </button>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 pb-3 transition-opacity ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="前のシーン"
          className="rounded bg-black/40 px-2.5 py-1 text-[13px] text-white/80 hover:bg-black/60 disabled:opacity-30"
        >
          ⏮
        </button>
        <button
          onClick={() => setPaused((prev) => !prev)}
          aria-label={paused ? '再生' : '一時停止'}
          className="rounded bg-black/40 px-3 py-1 text-[13px] text-white/80 hover:bg-black/60"
        >
          {paused ? '▶' : '⏸'}
        </button>
        <button
          onClick={() => goTo(index + 1)}
          aria-label="次のシーン"
          className="rounded bg-black/40 px-2.5 py-1 text-[13px] text-white/80 hover:bg-black/60"
        >
          ⏭
        </button>
        <div className="ml-2 flex gap-1.5">
          {scenes.map((item, i) => (
            <button
              key={item.id}
              onClick={() => goTo(i)}
              aria-label={`シーン ${i + 1}`}
              className={`h-1.5 w-5 rounded-full transition-colors ${
                i === index && !finished ? 'bg-white/90' : 'bg-white/25 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
