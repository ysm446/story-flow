import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  IconMaximize,
  IconPause,
  IconPlay,
  IconSkipBack,
  IconSkipForward,
  IconTrash,
  IconX
} from '../../components/icons'
import {
  api,
  bgmFileUrl,
  cardFileUrl,
  type Card,
  type StoryDetail,
  type StorySummary,
  type WorkspaceSummary
} from '../../lib/api'
import { theaterFontFamily } from '../../lib/theaterFonts'
import { useUiSettings } from '../../store/settings'

// 動画ループのクロスディゾルブ時間（秒）
const VIDEO_CROSSFADE_SECONDS = 1.0

/**
 * ループの継ぎ目をクロスディゾルブで繋ぐ動画プレイヤー。
 * 同じ動画を 2 枚重ね、終端 fadeSeconds 手前でもう 1 枚を頭から再生開始する。
 *
 * 暗転対策: 2 枚を同時にフェード（1→0 と 0→1）すると中間点で合成不透明度が
 * 1 を下回り背景の黒が透ける（0.5 + 0.5×0.5 = 0.75）。そのため
 * 「下の動画は不透明のまま残し、上に重ねた新しい動画だけをフェードイン」する。
 * フェードの 2 倍より短い動画は通常ループにフォールバック。
 */
function CrossfadeLoopVideo({
  src,
  fadeSeconds = VIDEO_CROSSFADE_SECONDS,
  fitClass = 'object-cover',
  paused = false
}: {
  src: string
  fadeSeconds?: number
  fitClass?: string
  paused?: boolean
}) {
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const activeIndex = useRef(0)
  const switching = useRef(false)

  const refOf = (index: number) => (index === 0 ? videoARef : videoBRef)

  // 一時停止に追従: 停止中は両方止める。再開時はアクティブな側だけ再生する
  useEffect(() => {
    const first = videoARef.current
    const second = videoBRef.current
    if (paused) {
      first?.pause()
      second?.pause()
    } else {
      void refOf(activeIndex.current).current?.play().catch(() => undefined)
    }
  }, [paused])

  useEffect(() => {
    activeIndex.current = 0
    switching.current = false
    const first = videoARef.current
    const second = videoBRef.current
    if (first) {
      first.style.transition = 'none'
      first.style.opacity = '1'
      first.style.zIndex = '2'
      first.currentTime = 0
      if (!paused) void first.play().catch(() => undefined)
    }
    if (second) {
      second.style.transition = 'none'
      second.style.opacity = '0'
      second.style.zIndex = '1'
      second.pause()
    }
  }, [src])

  const handleTimeUpdate = (index: number) => {
    if (index !== activeIndex.current || switching.current) return
    const current = refOf(index).current
    const next = refOf(1 - index).current
    if (!current || !next) return

    const { duration, currentTime } = current
    if (!Number.isFinite(duration) || duration <= fadeSeconds * 2) return // 短尺は onEnded の通常ループ
    // timeupdate の発火間隔（〜250ms）で取りこぼさないよう少し余裕を持って開始する
    if (duration - currentTime > fadeSeconds + 0.3) return

    switching.current = true
    activeIndex.current = 1 - index

    // 旧側: 不透明のまま下に残す（フェードさせない = 黒が透けない）
    current.style.transition = 'none'
    current.style.zIndex = '1'
    current.style.opacity = '1'

    // 新側: 上に重ねて透明から不透明へフェードイン
    next.style.transition = 'none'
    next.style.opacity = '0'
    next.style.zIndex = '2'
    next.currentTime = 0
    void next.play().catch(() => undefined)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        next.style.transition = `opacity ${fadeSeconds}s linear`
        next.style.opacity = '1'
      })
    })

    // フェード完了後に旧側を止める
    window.setTimeout(() => {
      current.pause()
      switching.current = false
    }, fadeSeconds * 1000 + 150)
  }

  const handleEnded = (index: number) => {
    // クロスディゾルブ対象外（短尺）の動画はここで頭出しループ
    if (index !== activeIndex.current) return
    const video = refOf(index).current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => undefined)
  }

  return (
    // isolate: 動画の z-index をこのコンテナ内に閉じ込める（本文・コントロールより上に出さない）
    <div className="isolate relative h-full w-full">
      {[0, 1].map((index) => (
        <video
          key={index}
          ref={refOf(index)}
          src={src}
          muted
          playsInline
          preload="auto"
          onTimeUpdate={() => handleTimeUpdate(index)}
          onEnded={() => handleEnded(index)}
          className={`absolute inset-0 h-full w-full ${fitClass}`}
          style={index === 0 ? { opacity: 1, zIndex: 2 } : { opacity: 0, zIndex: 1 }}
        />
      ))}
    </div>
  )
}

/** 通常ループ動画（クロスディゾルブ無効時）。一時停止に追従する */
function LoopVideo({ src, fitClass, paused }: { src: string; fitClass: string; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (paused) video.pause()
    else void video.play().catch(() => undefined)
  }, [paused])
  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      className={`h-full w-full ${fitClass}`}
    />
  )
}

const BGM_FADE_MS = 900

/** ボリュームを to へフェードする（既存の interval があれば呼び出し側で管理） */
function fadeVolume(el: HTMLAudioElement, to: number, ms: number, onDone?: () => void): number {
  const from = el.volume
  const steps = Math.max(1, Math.round(ms / 40))
  let i = 0
  const timer = window.setInterval(() => {
    i += 1
    el.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)))
    if (i >= steps) {
      window.clearInterval(timer)
      onDone?.()
    }
  }, 40)
  return timer
}

/**
 * シーンごとの BGM を再生する。曲（bgm_id）が変わったときだけ 2 枚の <audio> で
 * クロスフェードする。一時停止・音量・オンオフに追従する。
 */
function BgmPlayer({
  bgmId,
  volume,
  paused,
  enabled
}: {
  bgmId: string | null
  volume: number
  paused: boolean
  enabled: boolean
}) {
  const refs = [useRef<HTMLAudioElement>(null), useRef<HTMLAudioElement>(null)]
  const active = useRef(0)
  const currentId = useRef<string | null>(null)
  const timers = useRef<Array<number | null>>([null, null])

  const startFade = (index: number, to: number, onDone?: () => void) => {
    const el = refs[index].current
    if (!el) return
    if (timers.current[index] !== null) window.clearInterval(timers.current[index]!)
    timers.current[index] = fadeVolume(el, to, BGM_FADE_MS, onDone)
  }

  // 曲の切り替え（クロスフェード）
  useEffect(() => {
    const target = enabled ? bgmId : null
    if (target === currentId.current) return
    currentId.current = target

    const curIndex = active.current
    const nextIndex = curIndex === 0 ? 1 : 0
    const curEl = refs[curIndex].current
    const nextEl = refs[nextIndex].current

    if (curEl) startFade(curIndex, 0, () => curEl.pause())

    if (target && nextEl) {
      nextEl.src = bgmFileUrl(target)
      nextEl.loop = true
      nextEl.volume = 0
      nextEl.currentTime = 0
      if (!paused) void nextEl.play().catch(() => undefined)
      startFade(nextIndex, volume)
      active.current = nextIndex
    }
    // target が null（曲なし）のときは curEl をフェードアウトするだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmId, enabled])

  // 一時停止に追従
  useEffect(() => {
    const el = refs[active.current].current
    if (!el) return
    if (paused) el.pause()
    else if (enabled && currentId.current) void el.play().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  // 音量変更に追従（アクティブな曲のみ）
  useEffect(() => {
    const el = refs[active.current].current
    if (el && currentId.current) el.volume = volume
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume])

  // アンマウント時に停止
  useEffect(() => {
    return () => {
      timers.current.forEach((t) => t !== null && window.clearInterval(t))
      refs.forEach((r) => r.current?.pause())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <audio ref={refs[0]} />
      <audio ref={refs[1]} />
    </>
  )
}

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

// 最終シーンのフェードアウト時間（レイヤーの opacity トランジション 1.2s + 余韻）
const THEATER_END_FADE_MS = 2_000

// 縦横比の設定値 → 数値（幅 / 高さ）。auto は null = ウィンドウに合わせる
const ASPECT_RATIO_NUM: Record<string, number | null> = {
  auto: null,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '1:1': 1
}

/**
 * Theater: 生成済み story の鑑賞。
 * Ken Burns（パン/ズーム）+ テキスト長に応じたオート送り + クロスフェード。
 */
export function TheaterPhase() {
  const [stories, setStories] = useState<StorySummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceFilter, setWorkspaceFilter] = useState('')
  const [playing, setPlaying] = useState<{ story: StoryDetail; cards: Map<string, Card> } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStories = useCallback(async () => {
    try {
      const result = await api.listStories(workspaceFilter || undefined)
      setStories(result.stories)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [workspaceFilter])

  useEffect(() => {
    void loadStories()
  }, [loadStories])

  useEffect(() => {
    void api.listWorkspaces().then((result) => setWorkspaces(result.workspaces)).catch(() => setWorkspaces([]))
  }, [])

  const workspaceName = useCallback(
    (id: string | null) => (id ? workspaces.find((workspace) => workspace.id === id)?.name ?? null : null),
    [workspaces]
  )

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

      {workspaces.length > 0 && (
        <select
          value={workspaceFilter}
          onChange={(event) => setWorkspaceFilter(event.target.value)}
          className="mt-4 rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px]"
          title="作品で絞り込み"
        >
          <option value="">すべての作品</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      )}

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
                  {workspaceName(story.workspace_id) && (
                    <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
                      {workspaceName(story.workspace_id)}
                    </span>
                  )}
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
                className="flex shrink-0 items-center gap-1.5 rounded bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                <IconPlay size={12} />
                {loadingId === story.id ? '読み込み中…' : '再生'}
              </button>
              <button
                onClick={() => void handleDelete(story)}
                disabled={loadingId !== null}
                aria-label="削除"
                className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
              >
                <IconTrash size={14} />
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
  const [ending, setEnding] = useState(false) // 最終シーンの暗転（フェードアウト）中
  const [finished, setFinished] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = useCallback(async () => {
    setIsFullscreen(await window.storyFlow.toggleFullScreen())
  }, [])

  // プレイヤー終了時は必ず全画面を解除する
  useEffect(() => {
    return () => {
      void window.storyFlow.setFullScreen(false)
    }
  }, [])
  const [visibleChars, setVisibleChars] = useState(0)
  const textRef = useRef<HTMLDivElement>(null)

  // ステージの縦横比を正確に反映するため、コンテナ実寸を測って px でサイズを決める
  // （CSS の aspect-ratio + width% では横長コンテナで幅が縮まず 4:3 が崩れて上下が切れる）
  const stageOuterRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = stageOuterRef.current
    if (!el) return
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scene = scenes[index]
  const isStreaming = uiSettings.theaterTextStreaming
  const streamMsPerChar = uiSettings.theaterTextStreamMsPerChar

  // 本文ストリーミング: シーン切替でリセットし、1 文字ずつ増やす（一時停止で止まる）
  useEffect(() => {
    setVisibleChars(0)
    if (textRef.current) textRef.current.scrollTop = 0
  }, [index])

  // ストリーミング中は最新の行が見えるように追従スクロール
  useEffect(() => {
    if (!isStreaming) return
    const el = textRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleChars, isStreaming])

  // ストリーミングオフで長文がはみ出す場合は、表示時間に合わせてゆっくり自動スクロール
  useEffect(() => {
    if (isStreaming || paused || finished || !scene) return
    const el = textRef.current
    if (!el) return
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return
    // 冒頭 2 秒は静止、最後の 2 秒は最下部で静止する配分
    const duration = Math.max(1_000, sceneDurationMs(scene.prose) - 4_000)
    const startTop = el.scrollTop
    const startedAt = Date.now() + 2_000
    const timer = setInterval(() => {
      const progress = Math.min(1, Math.max(0, (Date.now() - startedAt) / duration))
      el.scrollTop = startTop + (maxScroll - startTop) * progress
      if (progress >= 1) clearInterval(timer)
    }, 50)
    return () => clearInterval(timer)
  }, [index, isStreaming, paused, finished, scene])

  useEffect(() => {
    if (!isStreaming || paused || finished || !scene) return
    if (visibleChars >= scene.prose.length) return
    const timer = setInterval(() => {
      setVisibleChars((prev) => Math.min(prev + 1, scene.prose.length))
    }, streamMsPerChar)
    return () => clearInterval(timer)
  }, [isStreaming, paused, finished, scene, streamMsPerChar, visibleChars >= (scene?.prose.length ?? 0)])

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return
      if (next >= scenes.length) {
        // 即座に終了画面を出さず、最後のコマをフェードアウトさせてから終わる
        setEnding(true)
        return
      }
      setEnding(false)
      setFinished(false)
      setIndex(next)
    },
    [scenes.length]
  )

  // 暗転が終わったら終了画面へ（レイヤーの opacity トランジション 1.2s + 余韻）
  useEffect(() => {
    if (!ending) return
    const timer = setTimeout(() => {
      setEnding(false)
      setFinished(true)
      setPaused(true)
    }, THEATER_END_FADE_MS)
    return () => clearTimeout(timer)
  }, [ending])

  // オート送り（ストリーミングが遅い設定でも文字送りが終わる前に切り替わらないようにする）
  useEffect(() => {
    if (paused || finished || ending || !scene) return
    const streamingMs = isStreaming ? scene.prose.length * streamMsPerChar + 3_000 : 0
    const duration = Math.max(sceneDurationMs(scene.prose), streamingMs)
    const timer = setTimeout(() => goTo(index + 1), duration)
    return () => clearTimeout(timer)
  }, [index, paused, finished, ending, scene, goTo, isStreaming, streamMsPerChar])

  // キーボード操作（Esc は 全画面解除 → もう一度で一覧へ の 2 段階）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isFullscreen) {
          void window.storyFlow.setFullScreen(false)
          setIsFullscreen(false)
        } else {
          onExit()
        }
      } else if (event.key === ' ') {
        event.preventDefault()
        setPaused((prev) => !prev)
      } else if (event.key === 'ArrowRight') goTo(index + 1)
      else if (event.key === 'ArrowLeft') goTo(index - 1)
      else if (event.key === 'f' || event.key === 'F') void toggleFullscreen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, goTo, onExit, isFullscreen, toggleFullscreen])

  // マウスが止まったらコントロールを隠す
  useEffect(() => {
    if (!controlsVisible) return
    const timer = setTimeout(() => setControlsVisible(false), 3_000)
    return () => clearTimeout(timer)
  }, [controlsVisible, index])

  // ステージの形: 縦横比 auto はコンテナ形（× スケール）。比率指定時はその比率の額縁を
  // コンテナ（× スケール）に収まる最大サイズで中央に置く。object-fit で切れる/余白が決まる
  const aspectRatio = ASPECT_RATIO_NUM[uiSettings.theaterAspectRatio] ?? null
  const scale = uiSettings.theaterStageScale / 100
  const availW = containerSize.w * scale
  const availH = containerSize.h * scale
  let stageStyle: CSSProperties
  if (aspectRatio === null) {
    stageStyle = { width: availW, height: availH }
  } else {
    // 比率を保ったまま avail に収める（width = min(availW, availH * ratio)）
    const width = Math.min(availW, availH * aspectRatio)
    stageStyle = { width, height: width / aspectRatio }
  }
  const fitClass = uiSettings.theaterFitMode === 'contain' ? 'object-contain' : 'object-cover'

  return (
    <div
      ref={stageOuterRef}
      className="flex h-full items-center justify-center overflow-hidden bg-black"
    >
      {uiSettings.theaterBgmEnabled && (
        <BgmPlayer
          bgmId={finished || ending ? null : scene?.bgm_id ?? null}
          volume={uiSettings.theaterBgmVolume}
          paused={paused}
          enabled={uiSettings.theaterBgmEnabled}
        />
      )}
      <div
        className="relative overflow-hidden bg-black"
        style={stageStyle}
        onMouseMove={() => setControlsVisible(true)}
        onClick={() => setPaused((prev) => !prev)}
      >
      {/* シーンレイヤー（クロスフェード） */}
      {scenes.map((item, i) => {
        const card = cards.get(item.card_id)
        const isActive = i === index && !finished && !ending
        return (
          <div key={item.id} className={`theater-layer ${isActive ? 'is-active' : ''}`}>
            {card?.media_path ? (
              card.media_type === 'video' ? (
                isActive &&
                (uiSettings.theaterVideoLoopCrossfade ? (
                  <CrossfadeLoopVideo
                    src={cardFileUrl(card.id, false)}
                    fadeSeconds={uiSettings.theaterVideoCrossfadeSeconds}
                    fitClass={fitClass}
                    paused={paused}
                  />
                ) : (
                  <LoopVideo src={cardFileUrl(card.id, false)} fitClass={fitClass} paused={paused} />
                ))
              ) : (
                <img
                  src={cardFileUrl(card.id, false)}
                  alt=""
                  className={`h-full w-full ${fitClass} ${isActive ? `kenburns-${i % 4}` : ''}`}
                  style={{ animationPlayState: paused ? 'paused' : 'running' }}
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

      {/* 本文（最大高を超える長文はスクロール。ストリーミング時は追従、オフ時はオート） */}
      {!finished && scene && (
        <div
          key={scene.id}
          className="absolute inset-x-0 bottom-0 px-10 pb-14 pt-6 transition-opacity duration-[1200ms]"
          style={{ opacity: ending ? 0 : 1 }}
        >
          <div ref={textRef} className="no-scrollbar mx-auto max-h-[25vh] max-w-2xl overflow-y-auto">
            <p
              className="whitespace-pre-wrap leading-[2] text-white/95 [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]"
              style={{
                fontSize: `${uiSettings.theaterFontSizePx}px`,
                fontFamily: theaterFontFamily(uiSettings.theaterFontId)
              }}
            >
              {isStreaming ? scene.prose.slice(0, visibleChars) : scene.prose}
            </p>
          </div>
        </div>
      )}

      {/* 終了画面 */}
      {finished && (
        <div className="theater-fadein absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/70">
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
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? '全画面を解除' : '全画面'}
            title={isFullscreen ? '全画面を解除（F / Esc）' : '全画面（F）'}
            className="flex items-center rounded bg-black/40 px-2.5 py-1.5 text-white/80 hover:bg-black/60"
          >
            <IconMaximize size={14} />
          </button>
          <button
            onClick={onExit}
            aria-label="終了"
            className="flex items-center rounded bg-black/40 px-2.5 py-1.5 text-white/80 hover:bg-black/60"
          >
            <IconX size={14} />
          </button>
        </div>
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
          className="flex items-center rounded bg-black/40 px-2.5 py-1.5 text-white/80 hover:bg-black/60 disabled:opacity-30"
        >
          <IconSkipBack size={13} />
        </button>
        <button
          onClick={() => setPaused((prev) => !prev)}
          aria-label={paused ? '再生' : '一時停止'}
          className="flex items-center rounded bg-black/40 px-3 py-1.5 text-white/80 hover:bg-black/60"
        >
          {paused ? <IconPlay size={13} /> : <IconPause size={13} />}
        </button>
        <button
          onClick={() => goTo(index + 1)}
          aria-label="次のシーン"
          className="flex items-center rounded bg-black/40 px-2.5 py-1.5 text-white/80 hover:bg-black/60"
        >
          <IconSkipForward size={13} />
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
    </div>
  )
}
