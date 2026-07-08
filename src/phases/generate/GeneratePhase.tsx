import { useEffect, useMemo, useState } from 'react'
import { api, type Card, type CardTone, type GenerateEvent } from '../../lib/api'
import { postSse } from '../../lib/sse'
import { useAppStore } from '../../store/appStore'
import { PromptEditor } from './PromptEditor'

const ROLE_LABELS: Record<string, string> = {
  intro: '導入',
  rising: '展開',
  turn: '転換',
  climax: 'クライマックス',
  ending: '結末'
}

const TONE_OPTIONS: Array<{ value: CardTone | ''; label: string }> = [
  { value: '', label: '指定なし' },
  { value: 'happy', label: 'ハッピー' },
  { value: 'bad', label: 'バッド' },
  { value: 'bitter', label: 'ビター' },
  { value: 'neutral', label: 'ニュートラル' }
]

type SceneEvent = Extract<GenerateEvent, { type: 'scene' }>

type RunStatus = 'idle' | 'starting-model' | 'generating' | 'done' | 'error'

/**
 * Generate: アンカー列（v1 は Compose 未実装のためここで直接選ぶ）を逐次清書する。
 * SSE でシーンが 1 枚ずつ埋まっていく進行を表示する。
 */
export function GeneratePhase() {
  const { composition, setComposition } = useAppStore()
  const [allCards, setAllCards] = useState<Card[]>([])
  const [addCardId, setAddCardId] = useState('')
  const [targetTone, setTargetTone] = useState<CardTone | ''>('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [scenes, setScenes] = useState<SceneEvent[]>([])
  const [storyId, setStoryId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.listCards().then((result) => setAllCards(result.cards)).catch(() => setAllCards([]))
  }, [])

  const cardById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards])
  const anchors = composition.anchorCardIds.map((id) => cardById.get(id)).filter(Boolean) as Card[]
  const remaining = allCards.filter((card) => !composition.anchorCardIds.includes(card.id))
  const isRunning = status === 'starting-model' || status === 'generating'

  const setAnchors = (anchorCardIds: string[]) => setComposition({ ...composition, anchorCardIds })

  const moveAnchor = (index: number, delta: number) => {
    const next = [...composition.anchorCardIds]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setAnchors(next)
  }

  const handleGenerate = async () => {
    if (anchors.length === 0 || isRunning) return
    setScenes([])
    setStoryId(null)
    setError(null)
    setStatus('starting-model')
    try {
      // writer モデルが未起動なら起動して待つ
      let settings = await window.storyFlow.listModels()
      if (!settings.isServerInstalled) {
        throw new Error('llama-server が未インストールです。セットアップからインストールしてください。')
      }
      if (!settings.isModelLoaded) {
        settings = (await window.storyFlow.ensureLlama()).settings
      }

      setStatus('generating')
      await postSse<GenerateEvent>(
        '/generate',
        {
          card_ids: composition.anchorCardIds,
          plot: composition.plot,
          target_tone: targetTone || null,
          writer_base_url: settings.llamaBaseUrl
        },
        (event) => {
          if (event.type === 'scene') {
            setScenes((prev) => [...prev.filter((scene) => scene.position !== event.position), event])
          } else if (event.type === 'done') {
            setStoryId(event.story_id)
            setStatus('done')
          } else {
            setError(event.message)
            setStatus('error')
          }
        }
      )
      setStatus((prev) => (prev === 'generating' ? 'done' : prev))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('error')
    }
  }

  const inputClass =
    'rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  return (
    <div className="mx-auto flex h-full max-w-6xl gap-6 px-6 py-6">
      {/* 左: 構成入力 */}
      <div className="w-[380px] shrink-0 space-y-5 overflow-y-auto pr-1">
        <div>
          <h1 className="text-[18px] font-semibold">Generate — 生成</h1>
          <p className="mt-1 text-[12px] text-[var(--text-dim)]">
            アンカー列を左から 1 シーンずつ清書し、確定事実を持ち越します。
          </p>
        </div>

        {/* アンカー列 */}
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-[var(--text-dim)]">アンカー列（上から順に清書）</h2>
          {anchors.length === 0 && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] text-[var(--text-faint)]">
              下のセレクトからカードを追加してください。
            </div>
          )}
          <ul className="space-y-1.5">
            {anchors.map((card, index) => (
              <li
                key={card.id}
                className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5"
              >
                <span className="w-5 shrink-0 text-center text-[12px] text-[var(--text-faint)]">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{card.title}</span>
                <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
                  {ROLE_LABELS[card.role]}
                </span>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    onClick={() => moveAnchor(index, -1)}
                    disabled={isRunning || index === 0}
                    aria-label="上へ"
                    className="rounded px-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveAnchor(index, 1)}
                    disabled={isRunning || index === anchors.length - 1}
                    aria-label="下へ"
                    className="rounded px-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setAnchors(composition.anchorCardIds.filter((id) => id !== card.id))}
                    disabled={isRunning}
                    aria-label="外す"
                    className="rounded px-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <select
              value={addCardId}
              onChange={(event) => setAddCardId(event.target.value)}
              disabled={isRunning}
              className={`${inputClass} min-w-0 flex-1`}
            >
              <option value="">カードを選択…</option>
              {remaining.map((card) => (
                <option key={card.id} value={card.id}>
                  [{ROLE_LABELS[card.role]}] {card.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!addCardId) return
                setAnchors([...composition.anchorCardIds, addCardId])
                setAddCardId('')
              }}
              disabled={isRunning || !addCardId}
              className="shrink-0 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[13px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
            >
              追加
            </button>
          </div>
        </section>

        {/* プロット・トーン */}
        <label className="block">
          <span className="mb-1 block text-[12px] text-[var(--text-dim)]">プロット（物語全体の方向づけ。任意）</span>
          <textarea
            value={composition.plot}
            onChange={(event) => setComposition({ ...composition, plot: event.target.value })}
            disabled={isRunning}
            rows={3}
            className={`${inputClass} w-full leading-relaxed`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] text-[var(--text-dim)]">目標トーン（結末の着地。任意）</span>
          <select
            value={targetTone}
            onChange={(event) => setTargetTone(event.target.value as CardTone | '')}
            disabled={isRunning}
            className={`${inputClass} w-full`}
          >
            {TONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => void handleGenerate()}
          disabled={isRunning || anchors.length === 0}
          className="w-full rounded bg-[var(--accent)] px-4 py-2.5 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'starting-model' ? 'モデル起動中…' : status === 'generating' ? '生成中…' : '生成する'}
        </button>

        {/* system prompt 編集 */}
        <details className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
          <summary className="cursor-pointer text-[13px] text-[var(--text-dim)]">
            清書プロンプトを編集（上級者向け）
          </summary>
          <div className="mt-3">
            <PromptEditor name="writer" />
          </div>
        </details>
      </div>

      {/* 右: 進行表示 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <h2 className="text-[13px] font-semibold text-[var(--text-dim)]">生成の進行</h2>

        {error && (
          <div className="mt-3 rounded-md border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[13px] text-[var(--danger)]">
            {error}
          </div>
        )}

        {storyId && (
          <div className="mt-3 rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[13px]">
            物語を保存しました（story: <span className="font-mono text-[12px]">{storyId.slice(0, 8)}…</span>）。
            Theater フェーズで再生できます（フェーズ 3 実装後）。
          </div>
        )}

        <div className="mt-3 space-y-3">
          {anchors.map((card, index) => {
            const scene = scenes.find((item) => item.position === index)
            const isNext = !scene && scenes.length === index && isRunning
            return (
              <div
                key={card.id}
                className={`rounded-md border px-4 py-3 ${
                  scene
                    ? 'border-[var(--border)] bg-[var(--bg-card)]'
                    : isNext
                      ? 'border-[var(--accent-border)] bg-[var(--bg-card)]'
                      : 'border-dashed border-[var(--border)] bg-transparent'
                }`}
              >
                <div className="flex items-center gap-2 text-[12px] text-[var(--text-dim)]">
                  <span className="font-semibold">シーン {index + 1}</span>
                  <span className="truncate">{card.title}</span>
                  {isNext && <span className="text-[var(--accent)]">清書中…</span>}
                </div>
                {scene && (
                  <>
                    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.8]">{scene.prose}</p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--text-faint)]">
                        確定事実（このシーン終了時点）
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-[var(--bg-canvas)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--text-dim)]">
                        {JSON.stringify(scene.state_after, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
              </div>
            )
          })}
          {anchors.length === 0 && (
            <div className="mt-10 text-center text-[13px] text-[var(--text-faint)]">
              アンカー列を組んで「生成する」を押すと、ここにシーンが 1 枚ずつ埋まっていきます。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
