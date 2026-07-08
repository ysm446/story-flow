import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api, type Card, type GenerateEvent, type StorySummary } from '../../lib/api'
import { postSse } from '../../lib/sse'
import { useAppStore } from '../../store/appStore'
import { useUiSettings } from '../../store/settings'

type SceneStatus = 'pending' | 'streaming' | 'done' | 'reused' | 'stale'

interface SceneView {
  cardId: string
  title: string
  prose: string
  status: SceneStatus
}

type RunStatus = 'idle' | 'starting-model' | 'generating' | 'done' | 'error'

type RegenMode = 'from_here' | 'single'

interface SceneNodeData {
  index: number
  scene: SceneView
  isRunning: boolean
  hasTake: boolean
  onRegenerate: (index: number, mode: RegenMode) => void
}

const STATUS_LABELS: Record<SceneStatus, string | null> = {
  pending: null,
  streaming: '清書中…',
  done: null,
  reused: 'コピー',
  stale: '要確認'
}

function SceneNode({ data }: NodeProps) {
  const { index, scene, isRunning, hasTake, onRegenerate } = data as unknown as SceneNodeData
  const statusLabel = STATUS_LABELS[scene.status]

  return (
    <div
      className={`w-[300px] overflow-hidden rounded-md border bg-[var(--bg-card)] ${
        scene.status === 'streaming'
          ? 'border-[var(--accent)]'
          : scene.status === 'stale'
            ? 'border-[var(--danger)]'
            : 'border-[var(--border-strong)]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-[var(--accent)]" />
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
        <span className="text-[11px] font-semibold text-[var(--text-faint)]">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{scene.title}</span>
        {statusLabel && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
              scene.status === 'streaming'
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : scene.status === 'stale'
                  ? 'bg-[rgba(239,68,68,0.15)] text-[var(--danger)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-faint)]'
            }`}
            title={scene.status === 'stale' ? '前のシーンを再生成したため、確定事実とずれている可能性があります' : ''}
          >
            {statusLabel}
          </span>
        )}
      </div>
      {/* 文章の長さに合わせてノードが縦に伸びる（スクロールしない） */}
      <div className="min-h-[48px] px-2.5 py-2">
        {scene.prose ? (
          <p className="whitespace-pre-wrap text-[11px] leading-[1.7] text-[var(--text)]">
            {scene.prose}
            {scene.status === 'streaming' && <span className="animate-pulse text-[var(--accent)]">▍</span>}
          </p>
        ) : (
          <p className="text-[11px] text-[var(--text-faint)]">
            {scene.status === 'pending' ? '（未生成）' : ''}
          </p>
        )}
      </div>
      <div className="flex gap-1 border-t border-[var(--border)] px-2 py-1.5">
        <button
          onClick={() => onRegenerate(index, 'single')}
          disabled={isRunning || !hasTake}
          title="このシーンだけ書き直す（以降のシーンはそのまま。確定事実がずれる可能性あり）"
          className="flex-1 rounded border border-[var(--border-strong)] px-1 py-1 text-[10px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          ↻ このシーンのみ
        </button>
        <button
          onClick={() => onRegenerate(index, 'from_here')}
          disabled={isRunning || !hasTake}
          title="このシーンから最後までを書き直す"
          className="flex-1 rounded border border-[var(--border-strong)] px-1 py-1 text-[10px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          ↻ ここから最後まで
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-[var(--accent)]" />
    </div>
  )
}

const nodeTypes = { scene: SceneNode }

/**
 * Generate: フローチャート上のノードに清書文がストリーミングで書き込まれる実行ビュー。
 * 生成結果は毎回「テイク」として保存され（上書きしない）、テイク一覧からいつでも
 * 後戻り・そこからの部分再生成ができる。構成の編集は Compose で行う。
 */
export function GeneratePhase() {
  return (
    <ReactFlowProvider>
      <GenerateInner />
    </ReactFlowProvider>
  )
}

function GenerateInner() {
  const { composition, setPhase, pendingGenerate, setPendingGenerate, workspaceId, composeNodes } = useAppStore()
  const { settings: uiSettings } = useUiSettings()
  const [allCards, setAllCards] = useState<Card[]>([])
  const [takes, setTakes] = useState<StorySummary[]>([])
  const [currentTakeId, setCurrentTakeId] = useState<string | null>(null)
  const [sceneViews, setSceneViews] = useState<SceneView[]>([])
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const autoStarted = useRef(false)

  const cardById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards])
  const isRunning = status === 'starting-model' || status === 'generating'

  const refreshTakes = useCallback(async () => {
    if (!workspaceId) return
    try {
      setTakes((await api.listStories(workspaceId)).stories)
    } catch {
      // 一覧はベストエフォート
    }
  }, [workspaceId])

  // 初期化: カード一覧 + テイク一覧。最新テイクがあれば表示する
  useEffect(() => {
    let canceled = false
    void (async () => {
      const cards = await api.listCards().catch(() => ({ cards: [] as Card[] }))
      if (canceled) return
      setAllCards(cards.cards)
      if (!workspaceId) return
      const list = (await api.listStories(workspaceId).catch(() => ({ stories: [] as StorySummary[] }))).stories
      if (canceled) return
      setTakes(list)
      // Compose からの自動生成が控えている場合はテイク表示をスキップ
      if (!pendingGenerate && list.length > 0) {
        void showTake(list[0].id, new Map(cards.cards.map((card) => [card.id, card])))
      }
    })()
    return () => {
      canceled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const showTake = async (storyId: string, cards?: Map<string, Card>) => {
    try {
      const story = await api.getStory(storyId)
      const lookup = cards ?? cardById
      setSceneViews(
        [...story.scenes]
          .sort((a, b) => a.position - b.position)
          .map((scene) => ({
            cardId: scene.card_id,
            title: lookup.get(scene.card_id)?.title ?? '(削除済みカード)',
            prose: scene.prose,
            status: 'done' as const
          }))
      )
      setCurrentTakeId(storyId)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const runGeneration = async (options: { baseStoryId: string | null; startPosition: number; mode: 'full' | RegenMode }) => {
    if (isRunning) return
    // スロット列: full は Compose の構成、部分再生成は表示中テイクのカード列
    const slotCards =
      options.mode === 'full'
        ? composition.anchors.map((anchor) => ({ cardId: anchor.cardId, instruction: anchor.instruction }))
        : sceneViews.map((scene) => {
            const node = composeNodes.find((item) => item.id === scene.cardId)
            const instruction = node ? (((node.data as Record<string, unknown>).instruction as string) ?? '').trim() : ''
            return { cardId: scene.cardId, instruction: instruction || null }
          })
    if (slotCards.length === 0) return

    setError(null)
    setStatus('starting-model')
    setSceneViews(
      slotCards.map((slot, index) => ({
        cardId: slot.cardId,
        title: cardById.get(slot.cardId)?.title ?? '',
        prose: '',
        status: 'pending' as const
      }))
    )

    try {
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
          slots: slotCards.map((slot) => ({ card_id: slot.cardId, instruction: slot.instruction })),
          plot: composition.plot,
          target_tone: composition.targetTone || null,
          writer_base_url: settings.llamaBaseUrl,
          workspace_id: workspaceId,
          prompt_preset_id: composition.promptPresetId,
          scene_length: composition.sceneLength || null,
          include_images: uiSettings.generateIncludeImages && settings.supportsVision,
          base_story_id: options.baseStoryId,
          start_position: options.startPosition,
          mode: options.mode
        },
        (event) => {
          if (event.type === 'delta') {
            setSceneViews((prev) =>
              prev.map((scene, index) =>
                index === event.position
                  ? { ...scene, prose: scene.prose + event.text, status: 'streaming' }
                  : scene
              )
            )
          } else if (event.type === 'scene') {
            setSceneViews((prev) =>
              prev.map((scene, index) =>
                index === event.position
                  ? {
                      ...scene,
                      prose: event.prose,
                      status: event.stale ? 'stale' : event.reused ? 'reused' : 'done'
                    }
                  : scene
              )
            )
          } else if (event.type === 'done') {
            setCurrentTakeId(event.story_id)
            setStatus('done')
            void refreshTakes()
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

  const handleRegenerate = useCallback(
    (index: number, mode: RegenMode) => {
      if (!currentTakeId) return
      void runGeneration({ baseStoryId: currentTakeId, startPosition: index, mode })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTakeId, sceneViews, isRunning, composition, workspaceId, composeNodes, cardById]
  )

  // Compose の「生成する」からの遷移なら自動開始
  useEffect(() => {
    if (pendingGenerate && !autoStarted.current) {
      autoStarted.current = true
      setPendingGenerate(false)
      void runGeneration({ baseStoryId: null, startPosition: 0, mode: 'full' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGenerate])

  const handleDeleteTake = async (take: StorySummary) => {
    if (!window.confirm('このテイクを削除しますか？')) return
    try {
      await api.deleteStory(take.id)
      if (currentTakeId === take.id) {
        setCurrentTakeId(null)
        setSceneViews([])
      }
      void refreshTakes()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  // ノード配置: Compose のカード位置を引き継ぎ、無ければ横一列
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = sceneViews.map((scene, index) => {
      const composeNode = composeNodes.find((item) => item.id === scene.cardId)
      const position = composeNode ? { ...composeNode.position } : { x: 60 + index * 340, y: 160 }
      return {
        id: `scene-${index}`,
        type: 'scene',
        position,
        data: {
          index,
          scene,
          isRunning,
          hasTake: currentTakeId !== null,
          onRegenerate: handleRegenerate
        } satisfies SceneNodeData as unknown as Record<string, unknown>
      }
    })
    const edges: Edge[] = sceneViews.slice(1).map((_, index) => ({
      id: `edge-${index}`,
      source: `scene-${index}`,
      target: `scene-${index + 1}`,
      type: 'smoothstep'
    }))
    return { nodes, edges }
  }, [sceneViews, composeNodes, isRunning, currentTakeId, handleRegenerate])

  return (
    <div className="flex h-full">
      {/* 左: 実行 + テイク一覧 */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
        <div className="space-y-2 border-b border-[var(--border)] p-3">
          <h1 className="text-[15px] font-semibold">Generate — 生成</h1>
          <button
            onClick={() => void runGeneration({ baseStoryId: null, startPosition: 0, mode: 'full' })}
            disabled={isRunning || composition.anchors.length === 0}
            className="w-full rounded bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'starting-model'
              ? 'モデル起動中…'
              : status === 'generating'
                ? '生成中…'
                : '新しいテイクを生成'}
          </button>
          {composition.anchors.length === 0 && (
            <div className="text-[11px] text-[var(--text-faint)]">
              構成がありません。
              <button onClick={() => setPhase('compose')} className="text-[var(--accent)] hover:underline">
                Compose で組む →
              </button>
            </div>
          )}
          {currentTakeId && status === 'done' && (
            <button
              onClick={() => setPhase('theater')}
              className="w-full rounded border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-[12px] hover:bg-[var(--accent-soft)]"
            >
              Theater で再生 →
            </button>
          )}
          {error && (
            <div className="rounded border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-2 py-1.5 text-[11px] text-[var(--danger)]">
              {error}
            </div>
          )}
        </div>

        <div className="border-b border-[var(--border)] px-3 py-2 text-[13px] font-semibold text-[var(--text-dim)]">
          テイク（後戻り・撮り直しの起点）
        </div>
        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {takes.length === 0 && (
            <div className="px-1 py-2 text-[12px] text-[var(--text-faint)]">まだテイクがありません。</div>
          )}
          {takes.map((take, index) => (
            <div
              key={take.id}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                currentTakeId === take.id
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] bg-[var(--bg-card)]'
              }`}
            >
              <button
                onClick={() => void showTake(take.id)}
                disabled={isRunning}
                className="min-w-0 flex-1 text-left disabled:opacity-50"
              >
                <span className="block truncate text-[12px]">
                  テイク {takes.length - index}
                  {take.parent_story_id && (
                    <span className="ml-1 text-[10px] text-[var(--text-faint)]" title="部分再生成から生まれたテイク">
                      ↻
                    </span>
                  )}
                </span>
                <span className="block text-[10px] text-[var(--text-faint)]">
                  {new Date(take.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ・{' '}
                  {take.scene_count} シーン
                </span>
              </button>
              <button
                onClick={() => void handleDeleteTake(take)}
                disabled={isRunning}
                aria-label="テイクを削除"
                className="shrink-0 rounded px-1 py-0.5 text-[11px] text-[var(--text-faint)] hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)] disabled:opacity-40"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* キャンバス */}
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          minZoom={0.2}
          maxZoom={1.5}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-[var(--bg-canvas)]"
        >
          <Background gap={20} />
        </ReactFlow>
        {sceneViews.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-faint)]">
            Compose で構成を組んで「生成する」を押すと、ここでノードに清書文が流れ込みます。
          </div>
        )}
      </div>
    </div>
  )
}
