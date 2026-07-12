import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { IconFilm, IconGrid, IconMusic, IconRotate, IconTrash } from '../../components/icons'
import { api, cardFileUrl, type Bgm, type Card, type GenerateEvent, type StorySummary } from '../../lib/api'
import { chainAnchors } from '../../lib/chain'
import { postSse } from '../../lib/sse'
import { useAppStore } from '../../store/appStore'
import { useUiSettings } from '../../store/settings'

type SceneStatus = 'pending' | 'selecting' | 'streaming' | 'done' | 'reused' | 'stale'

interface SceneView {
  cardId: string | null // おまかせスロットは選定されるまで null
  title: string
  prose: string
  status: SceneStatus
  bgmId: string | null
  selectionReason: string | null // 穴埋めで選ばれたシーンの選定理由
}

type RunStatus = 'idle' | 'starting-model' | 'generating' | 'done' | 'error'

type RegenMode = 'from_here' | 'single'

interface SceneNodeData {
  index: number
  scene: SceneView
  card: Card | undefined
  bgmTitle: string | null
  isRunning: boolean
  hasTake: boolean
  onRegenerate: (index: number, mode: RegenMode) => void
}

// ノードの横方向の最小間隔（ノード幅 300 + 余白）。重なり緩和の基準
const NODE_GAP_X = 360

const STATUS_LABELS: Record<SceneStatus, string | null> = {
  pending: null,
  selecting: 'カード選定中…',
  streaming: '清書中…',
  done: null,
  reused: 'コピー',
  stale: '要確認'
}

function SceneNode({ data }: NodeProps) {
  const { index, scene, card, bgmTitle, isRunning, hasTake, onRegenerate } = data as unknown as SceneNodeData
  const statusLabel = STATUS_LABELS[scene.status]

  return (
    <div
      className={`w-[300px] overflow-hidden rounded-md border bg-[var(--bg-card)] ${
        scene.status === 'streaming' || scene.status === 'selecting'
          ? 'border-[var(--accent)]'
          : scene.status === 'stale'
            ? 'border-[var(--danger)]'
            : 'border-[var(--border-strong)]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-[var(--accent)]" />
      {card?.media_path && (
        <div className="relative overflow-hidden bg-[var(--bg-canvas)]">
          <img
            src={cardFileUrl(card.id, true)}
            alt=""
            className="block h-auto w-full"
            draggable={false}
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
          {card.media_type === 'video' && (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 p-0.5 text-white/90">
              <IconFilm size={11} />
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
        <span className="text-[11px] font-semibold text-[var(--text-faint)]">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{scene.title}</span>
        {statusLabel && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
              scene.status === 'streaming' || scene.status === 'selecting'
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
      {scene.selectionReason && (
        <div
          className="border-b border-[var(--border)] px-2.5 py-1 text-[10px] leading-relaxed text-[var(--text-faint)]"
          title={scene.selectionReason}
        >
          <span className="font-semibold">選定: </span>
          <span>{scene.selectionReason}</span>
        </div>
      )}
      {bgmTitle && (
        <div
          className="flex items-center gap-1.5 border-b border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--text-faint)]"
          title={`BGM: ${bgmTitle}`}
        >
          <IconMusic size={11} />
          <span className="truncate">{bgmTitle}</span>
        </div>
      )}
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
          className="flex flex-1 items-center justify-center gap-1 rounded border border-[var(--border-strong)] px-1 py-1 text-[10px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          <IconRotate size={10} /> このシーンのみ
        </button>
        <button
          onClick={() => onRegenerate(index, 'from_here')}
          disabled={isRunning || !hasTake}
          title="このシーンから最後までを書き直す"
          className="flex flex-1 items-center justify-center gap-1 rounded border border-[var(--border-strong)] px-1 py-1 text-[10px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          <IconRotate size={10} /> ここから最後まで
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
  const { composition, phase, setPhase, pendingGenerate, setPendingGenerate, workspaceId, composeNodes, composeEdges } =
    useAppStore()
  const { settings: uiSettings } = useUiSettings()
  const [allCards, setAllCards] = useState<Card[]>([])
  const [allBgm, setAllBgm] = useState<Bgm[]>([])
  const [takes, setTakes] = useState<StorySummary[]>([])
  const [currentTakeId, setCurrentTakeId] = useState<string | null>(null)
  const [sceneViews, setSceneViews] = useState<SceneView[]>([])
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const abortRef = useRef<AbortController | null>(null)
  const reactFlow = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const fitPendingRef = useRef(false)

  // アンマウント（実質アプリ終了）時に進行中のストリームを畳む
  useEffect(() => () => abortRef.current?.abort(), [])

  // キャンバスのショートカット（Compose と同じ操作系）: A = 全体表示 / F = 選択ノードにフォーカス。
  // ノードを選択していなくても効くよう window で拾う（Generate 表示中のみ。
  // 入力欄へのタイプ中・修飾キー押下時は無視）
  useEffect(() => {
    if (phase !== 'generate') return
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'a') {
        event.preventDefault()
        void reactFlow.fitView({ padding: 0.15, duration: 300 })
      } else if (key === 'f') {
        const selected = nodes.filter((node) => node.selected)
        if (selected.length === 0) return
        event.preventDefault()
        void reactFlow.fitView({
          nodes: selected.map((node) => ({ id: node.id })),
          padding: 0.4,
          maxZoom: 1.2,
          duration: 300
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, nodes, reactFlow])

  const cardById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards])
  const bgmTitleById = useMemo(() => new Map(allBgm.map((bgm) => [bgm.id, bgm.title])), [allBgm])
  const isRunning = status === 'starting-model' || status === 'generating'
  // アンカー列は常に「いまの Compose グラフ」から導出する（一本鎖が未成立なら null）。
  // スナップショットを持ち回ると、Compose での編集後に古い構成で生成される事故になる
  const anchors = useMemo(() => chainAnchors(composeNodes, composeEdges), [composeNodes, composeEdges])

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
      void api.listBgm().then((result) => !canceled && setAllBgm(result.bgm)).catch(() => undefined)
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
            status: 'done' as const,
            bgmId: scene.bgm_id,
            selectionReason: scene.selection_reason
          }))
      )
      setCurrentTakeId(storyId)
      setError(null)
      fitPendingRef.current = true // 表示したテイクの全ノードが収まるように表示する
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const runGeneration = async (options: { baseStoryId: string | null; startPosition: number; mode: 'full' | RegenMode }) => {
    if (isRunning) return
    // スロット列: full は Compose のグラフから導出した鎖（おまかせ含む）、
    // 部分再生成は表示中テイクの確定済みカード列
    const slotCards =
      options.mode === 'full'
        ? (anchors ?? []).map((anchor) => ({
            kind: anchor.kind,
            cardId: anchor.cardId,
            instruction: anchor.instruction,
            bgmId: anchor.bgmId,
            targetRole: anchor.targetRole
          }))
        : sceneViews.map((scene) => {
            const node = composeNodes.find((item) => item.id === scene.cardId)
            const data = node ? (node.data as Record<string, unknown>) : null
            const instruction = data ? ((data.instruction as string) ?? '').trim() : ''
            return {
              kind: 'card' as const,
              cardId: scene.cardId,
              instruction: instruction || null,
              bgmId: (data?.bgmId as string) ?? null,
              targetRole: null
            }
          })
    if (slotCards.length === 0) return
    if (slotCards.some((slot) => slot.kind === 'card' && !slot.cardId)) return

    setError(null)
    setNotice(null)
    setStatus('starting-model')
    setSceneViews(
      slotCards.map((slot) => ({
        cardId: slot.cardId,
        title: slot.kind === 'gap' ? 'おまかせ' : (slot.cardId ? cardById.get(slot.cardId)?.title : '') ?? '',
        prose: '',
        status: 'pending' as const,
        bgmId: slot.bgmId ?? null,
        selectionReason: null
      }))
    )

    // モデル起動待ちの間もキャンセルできるよう、controller はここで作る
    const controller = new AbortController()
    abortRef.current = controller
    // done / error イベントを受けずにストリームが閉じた場合を成功と誤認しないための追跡
    let sawTerminalEvent = false
    try {
      let settings = await window.storyFlow.listModels()
      if (!settings.isServerInstalled) {
        throw new Error('llama-server が未インストールです。セットアップからインストールしてください。')
      }
      if (!settings.isModelLoaded) {
        settings = (await window.storyFlow.ensureLlama()).settings
      }
      // モデル起動中にキャンセルされた場合はここで抜ける（モデルの起動自体は止めない）
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')

      setStatus('generating')
      await postSse<GenerateEvent>(
        '/generate',
        {
          slots: slotCards.map((slot) => ({
            kind: slot.kind,
            card_id: slot.cardId,
            instruction: slot.instruction,
            bgm_id: slot.bgmId ?? null,
            target_role: slot.targetRole ?? null
          })),
          plot: composition.plot,
          target_tone: composition.targetTone || null,
          writer_base_url: settings.llamaBaseUrl,
          workspace_id: workspaceId,
          prompt_preset_id: composition.promptPresetId,
          scene_length: composition.sceneLength || null,
          gap_route: composition.gapRoute || null,
          include_images: uiSettings.generateIncludeImages && settings.supportsVision,
          include_bgm: uiSettings.theaterBgmEnabled,
          // 空配列も必ず送る（空 = ルートのみ。null にすると backend が「全カード」互換挙動になり、
          // チェックなしのときにアセット一覧に見えないフォルダのカードをおまかせが引いてしまう）
          folder_ids: composition.folderIds,
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
          } else if (event.type === 'selecting') {
            setSceneViews((prev) =>
              prev.map((scene, index) =>
                index === event.position ? { ...scene, status: 'selecting' } : scene
              )
            )
          } else if (event.type === 'selected') {
            // おまかせスロットにカードが確定した（このあと清書が始まる）
            setSceneViews((prev) =>
              prev.map((scene, index) =>
                index === event.position
                  ? {
                      ...scene,
                      cardId: event.card_id,
                      title: event.card_title || scene.title,
                      selectionReason: event.reason,
                      status: 'streaming'
                    }
                  : scene
              )
            )
          } else if (event.type === 'scene') {
            setSceneViews((prev) =>
              prev.map((scene, index) =>
                index === event.position
                  ? {
                      ...scene,
                      cardId: event.card_id,
                      title: event.card_title || scene.title,
                      prose: event.prose,
                      status: event.stale ? 'stale' : event.reused ? 'reused' : 'done',
                      bgmId: event.bgm_id,
                      selectionReason: event.selection_reason
                    }
                  : scene
              )
            )
          } else if (event.type === 'done') {
            sawTerminalEvent = true
            setCurrentTakeId(event.story_id)
            setStatus('done')
            void refreshTakes()
          } else {
            sawTerminalEvent = true
            setError(event.message)
            setStatus('error')
          }
        },
        controller.signal
      )
      if (!sawTerminalEvent) {
        throw new Error('生成が完了する前に接続が切れました。テイクは保存されていません。')
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        // ユーザーによるキャンセル。done を受信済みなら保存まで済んでいるので何もしない
        if (!sawTerminalEvent) {
          setSceneViews((prev) =>
            prev.map((scene) =>
              scene.status === 'selecting' || scene.status === 'streaming'
                ? { ...scene, status: 'pending' }
                : scene
            )
          )
          setNotice('生成をキャンセルしました（このテイクは保存されていません）')
          setStatus('idle')
        }
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
        setStatus('error')
      }
    } finally {
      abortRef.current = null
    }
  }

  const handleRegenerate = useCallback(
    (index: number, mode: RegenMode) => {
      if (!currentTakeId) return
      void runGeneration({ baseStoryId: currentTakeId, startPosition: index, mode })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTakeId, sceneViews, isRunning, composition, workspaceId, composeNodes, cardById, uiSettings, anchors]
  )

  // Compose の「生成する」からの遷移なら自動開始（常時マウントのため、来るたびに消費する）
  useEffect(() => {
    if (!pendingGenerate) return
    setPendingGenerate(false)
    void runGeneration({ baseStoryId: null, startPosition: 0, mode: 'full' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGenerate])

  // タブが表示されたらカード / BGM / テイク一覧を再取得する（常時マウントのため、
  // マウント時の初期化だけでは Vault での追加や Theater での削除に追随できない）
  useEffect(() => {
    if (phase !== 'generate') return
    void api.listCards().then((result) => setAllCards(result.cards)).catch(() => undefined)
    void api.listBgm().then((result) => setAllBgm(result.bgm)).catch(() => undefined)
    void refreshTakes()
  }, [phase, refreshTakes])

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

  // ノードの配置（重なり緩和）: Compose の座標を基準にしつつ、チェーン順に x 方向の
  // 最小間隔（NODE_GAP_X）を確保する。y は Compose の値を活かす。
  const computeLayout = useCallback(
    (count: number) => {
      const bases = Array.from({ length: count }, (_, i) => {
        // カード ID で照合し、おまかせスロット（選定前後とも）は鎖の同位置のノード ID で照合する
        const composeNode =
          composeNodes.find((item) => item.id === sceneViews[i]?.cardId) ??
          (anchors && anchors.length === count
            ? composeNodes.find((item) => item.id === anchors[i].nodeId)
            : undefined)
        return composeNode ? { ...composeNode.position } : { x: 60 + i * NODE_GAP_X, y: 120 }
      })
      for (let i = 1; i < bases.length; i++) {
        if (bases[i].x < bases[i - 1].x + NODE_GAP_X) bases[i].x = bases[i - 1].x + NODE_GAP_X
      }
      return bases
    },
    [composeNodes, sceneViews, anchors]
  )

  // シーンの内容（ストリーミング）を既存ノードへ流し込む。position と React Flow が
  // 付与した measured（測定済みサイズ）は既存ノードから引き継ぐ。ノードを毎回作り直すと
  // measured が失われ、ドラッグ中に「未測定 → 一瞬透明」のちらつきが出るため。
  // 配置優先順: 既存（ドラッグ後）> 重なり緩和レイアウト
  useEffect(() => {
    const layout = computeLayout(sceneViews.length)
    setNodes((prev) => {
      const prevById = new Map(prev.map((node) => [node.id, node]))
      return sceneViews.map((scene, index) => {
        const id = `scene-${index}`
        const existing = prevById.get(id)
        const position = existing?.position ?? layout[index]
        return {
          ...existing,
          id,
          type: 'scene',
          position,
          data: {
            index,
            scene,
            card: scene.cardId ? cardById.get(scene.cardId) : undefined,
            bgmTitle: scene.bgmId ? bgmTitleById.get(scene.bgmId) ?? '（削除済み BGM）' : null,
            isRunning,
            hasTake: currentTakeId !== null,
            onRegenerate: handleRegenerate
          } satisfies SceneNodeData as unknown as Record<string, unknown>
        }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneViews, composeNodes, isRunning, currentTakeId, handleRegenerate, cardById, bgmTitleById, computeLayout])

  // テイクを表示した直後は全体をフィット表示する。Generate が非表示（display:none）の間は
  // フィットできない（キャンバスのサイズが 0）ため、タブが表示されるまで持ち越す。
  // sceneViews → ノードの同期とサイズ測定を待ってから 1 フレーム遅らせて実行する
  useEffect(() => {
    if (!fitPendingRef.current || phase !== 'generate') return
    if (nodes.length !== sceneViews.length) return
    if (nodes.length > 0 && !nodesInitialized) return
    fitPendingRef.current = false
    if (nodes.length === 0) return
    window.setTimeout(() => void reactFlow.fitView({ padding: 0.2, duration: 300 }), 0)
  }, [phase, nodes, nodesInitialized, sceneViews.length, reactFlow])

  // 「整列」: ドラッグでの位置上書きを捨て、重なり緩和レイアウトに並べ直す
  const handleAlign = useCallback(() => {
    const layout = computeLayout(sceneViews.length)
    setNodes((prev) => prev.map((node, index) => ({ ...node, position: layout[index] ?? node.position })))
    window.setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 300 }), 0)
  }, [computeLayout, sceneViews.length, setNodes, reactFlow])

  // エッジは一本鎖。シーン数が変わったときだけ組み直す
  useEffect(() => {
    setEdges(
      sceneViews.slice(1).map((_, index) => ({
        id: `edge-${index}`,
        source: `scene-${index}`,
        target: `scene-${index + 1}`,
        type: 'smoothstep'
      }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneViews.length])

  return (
    <div className="flex h-full">
      {/* 左: 実行 + テイク一覧 */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
        <div className="space-y-2 border-b border-[var(--border)] p-3">
          <h1 className="text-[15px] font-semibold">Generate — 生成</h1>
          <button
            onClick={() => void runGeneration({ baseStoryId: null, startPosition: 0, mode: 'full' })}
            disabled={isRunning || !anchors || anchors.length === 0}
            className="w-full rounded bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'starting-model'
              ? 'モデル起動中…'
              : status === 'generating'
                ? '生成中…'
                : '新しいテイクを生成'}
          </button>
          {isRunning && (
            <button
              onClick={() => abortRef.current?.abort()}
              title="生成を中断する（ここまでの結果はテイクとして保存されません）"
              className="w-full rounded border border-[var(--border-strong)] px-4 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)]"
            >
              キャンセル
            </button>
          )}
          {(!anchors || anchors.length === 0) && (
            <div className="text-[11px] text-[var(--text-faint)]">
              {composeNodes.length > 0 ? '構成が一本の鎖になっていません。' : '構成がありません。'}
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
          {notice && (
            <div className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text-dim)]">
              {notice}
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
                <span className="flex items-center gap-1 truncate text-[12px]">
                  テイク {takes.length - index}
                  {take.parent_story_id && (
                    <span className="text-[var(--text-faint)]" title="部分再生成から生まれたテイク">
                      <IconRotate size={9} />
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
                className="shrink-0 rounded px-1 py-0.5 text-[var(--text-faint)] hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)] disabled:opacity-40"
              >
                <IconTrash size={12} />
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
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodesConnectable={false}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1, 2]}
          minZoom={0.2}
          maxZoom={1.5}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-[var(--bg-canvas)]"
        >
          <Background gap={20} />
        </ReactFlow>
        {sceneViews.length > 0 && (
          <button
            onClick={handleAlign}
            title="ノードを重ならないように整列する"
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-sidebar)]/95 px-2.5 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
          >
            <IconGrid size={13} />
            整列
          </button>
        )}
        {sceneViews.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-faint)]">
            Compose で構成を組んで「生成する」を押すと、ここでノードに清書文が流れ込みます。
          </div>
        )}
      </div>
    </div>
  )
}
