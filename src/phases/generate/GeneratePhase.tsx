import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Card, type GenerateEvent } from '../../lib/api'
import { postSse } from '../../lib/sse'
import { useAppStore } from '../../store/appStore'

const ROLE_LABELS: Record<string, string> = {
  intro: '導入',
  rising: '展開',
  turn: '転換',
  climax: 'クライマックス',
  ending: '結末'
}

const TONE_LABELS: Record<string, string> = {
  happy: 'ハッピー',
  bad: 'バッド',
  bitter: 'ビター',
  neutral: 'ニュートラル'
}

type SceneEvent = Extract<GenerateEvent, { type: 'scene' }>

type RunStatus = 'idle' | 'starting-model' | 'generating' | 'done' | 'error'

/**
 * Generate: 実行と進行表示。
 * 構成（アンカー・プロット・トーン・プロンプト）は Compose で決める。
 * Compose の「生成する」から遷移した場合は自動で生成を開始する。
 */
export function GeneratePhase() {
  const { composition, setPhase, pendingGenerate, setPendingGenerate, workspaceId } = useAppStore()
  const [allCards, setAllCards] = useState<Card[]>([])
  const [status, setStatus] = useState<RunStatus>('idle')
  const [scenes, setScenes] = useState<SceneEvent[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [storyId, setStoryId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoStarted = useRef(false)

  useEffect(() => {
    void api.listCards().then((result) => setAllCards(result.cards)).catch(() => setAllCards([]))
  }, [])

  const cardById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards])
  const anchors = composition.anchors
  const isRunning = status === 'starting-model' || status === 'generating'

  const handleGenerate = async () => {
    if (anchors.length === 0 || isRunning) return
    setScenes([])
    setDrafts({})
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
          slots: anchors.map((anchor) => ({ card_id: anchor.cardId, instruction: anchor.instruction })),
          plot: composition.plot,
          target_tone: composition.targetTone || null,
          writer_base_url: settings.llamaBaseUrl,
          workspace_id: workspaceId,
          prompt_preset_id: composition.promptPresetId,
          scene_length: composition.sceneLength || null
        },
        (event) => {
          if (event.type === 'delta') {
            setDrafts((prev) => ({ ...prev, [event.position]: (prev[event.position] ?? '') + event.text }))
          } else if (event.type === 'scene') {
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

  // Compose の「生成する」からの遷移なら自動開始
  useEffect(() => {
    if (pendingGenerate && !autoStarted.current) {
      autoStarted.current = true
      setPendingGenerate(false)
      void handleGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGenerate])

  return (
    <div className="mx-auto flex h-full max-w-6xl gap-6 px-6 py-6">
      {/* 左: 実行サマリ */}
      <div className="w-[320px] shrink-0 space-y-5 overflow-y-auto pr-1">
        <div>
          <h1 className="text-[18px] font-semibold">Generate — 生成</h1>
          <p className="mt-1 text-[12px] text-[var(--text-dim)]">
            構成の編集は Compose フェーズで行います。ここでは実行と進行を確認します。
          </p>
        </div>

        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-[var(--text-dim)]">アンカー列</h2>
          {anchors.length === 0 ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] text-[var(--text-faint)]">
              構成がありません。
              <button onClick={() => setPhase('compose')} className="ml-1 text-[var(--accent)] hover:underline">
                Compose で組む →
              </button>
            </div>
          ) : (
            <ol className="space-y-1.5">
              {anchors.map((anchor, index) => {
                const card = cardById.get(anchor.cardId)
                return (
                  <li
                    key={anchor.cardId}
                    className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5"
                  >
                    <span className="w-5 shrink-0 text-center text-[12px] text-[var(--text-faint)]">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{card?.title ?? anchor.cardId}</span>
                    {anchor.instruction && (
                      <span className="shrink-0 text-[11px]" title={anchor.instruction}>
                        📝
                      </span>
                    )}
                    {card?.role && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
                        {ROLE_LABELS[card.role]}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        {composition.plot.trim() && (
          <section>
            <h2 className="mb-1 text-[13px] font-semibold text-[var(--text-dim)]">プロット</h2>
            <p className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-dim)]">
              {composition.plot}
            </p>
          </section>
        )}

        {composition.targetTone && (
          <div className="text-[12px] text-[var(--text-dim)]">
            目標トーン:{' '}
            <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5">
              {TONE_LABELS[composition.targetTone]}
            </span>
          </div>
        )}

        <button
          onClick={() => void handleGenerate()}
          disabled={isRunning || anchors.length === 0}
          className="w-full rounded bg-[var(--accent)] px-4 py-2.5 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'starting-model'
            ? 'モデル起動中…'
            : status === 'generating'
              ? '生成中…'
              : status === 'done'
                ? 'もう一度生成する（別の読み味に）'
                : '生成する'}
        </button>
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
          <div className="mt-3 flex items-center gap-3 rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[13px]">
            <span>物語を保存しました。</span>
            <button
              onClick={() => setPhase('theater')}
              className="rounded bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Theater で再生 →
            </button>
          </div>
        )}

        <div className="mt-3 space-y-3">
          {anchors.map((anchor, index) => {
            const card = cardById.get(anchor.cardId)
            const scene = scenes.find((item) => item.position === index)
            const draft = !scene ? drafts[index] : undefined
            const isNext = !scene && scenes.length === index && isRunning
            return (
              <div
                key={anchor.cardId}
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
                  <span className="truncate">{card?.title ?? ''}</span>
                  {isNext && <span className="text-[var(--accent)]">清書中…</span>}
                </div>
                {draft !== undefined && (
                  <p className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.8] text-[var(--text-dim)]">
                    {draft}
                    <span className="animate-pulse text-[var(--accent)]">▍</span>
                  </p>
                )}
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
              Compose で構成を組んで「生成する」を押すと、ここにシーンが 1 枚ずつ埋まっていきます。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
