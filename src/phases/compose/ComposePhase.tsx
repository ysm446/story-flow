import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { IconFile, IconFilm, IconMore, IconMusic, IconPencil, IconPlus } from '../../components/icons'
import {
  api,
  cardFileUrl,
  type Bgm,
  type Card,
  type CardRole,
  type CardTone,
  type Folder,
  type GapRoute,
  type PromptConfig,
  type SceneLength,
  type Workspace,
  type WorkspaceGraph,
  type WorkspaceSummary
} from '../../lib/api'
import { computeChain } from '../../lib/chain'
import { expandFolderSelection, flattenTree } from '../../lib/folders'
import { reportStatusAction } from '../../lib/statusActions'
import { useAppStore } from '../../store/appStore'
import { LoreEditor } from './LoreEditor'

const ROLE_LABELS: Record<CardRole, string> = {
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

const GAP_ROUTE_OPTIONS: Array<{ value: GapRoute | ''; label: string }> = [
  { value: '', label: '直行（A から B へ最短で繋ぐ）' },
  { value: 'detour', label: '寄り道（序盤は話を広げ、終盤で B へ収束）' }
]

const SCENE_LENGTH_OPTIONS: Array<{ value: SceneLength | ''; label: string }> = [
  { value: '', label: '指定なし（プロンプト任せ）' },
  { value: 'short', label: '短め（約 150 字）' },
  { value: 'standard', label: '標準（約 300 字）' },
  { value: 'long', label: '長め（約 600 字）' }
]

const LAST_WORKSPACE_KEY = 'story-flow:last-workspace'
const AUTOSAVE_DELAY_MS = 800
const DEFAULT_ASSET_HEIGHT = 240

// アセットエリア → キャンバスへのドラッグ&ドロップで使う dataTransfer タイプ
// （OS からのファイルドロップと区別するため独自 MIME にする）
const CARD_DND_TYPE = 'application/x-story-flow-card'
const GAP_DND_TYPE = 'application/x-story-flow-gap'

// アセットエリア先頭のおまかせスロット疑似カードの選択 ID（カード ID と衝突しない値）
const GAP_ASSET_ID = '__gap__'

interface NameDialogState {
  title: string
  defaultValue: string
  onSubmit: (name: string) => void
}

/** 名前入力ダイアログ（Electron は window.prompt() 非対応のため自前実装） */
function NameDialog({ state, onClose }: { state: NameDialogState; onClose: () => void }) {
  const [value, setValue] = useState(state.defaultValue)

  const submit = () => {
    const name = value.trim()
    if (!name) return
    onClose()
    state.onSubmit(name)
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[380px] rounded-md border border-[var(--border-strong)] bg-[var(--bg-sidebar)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-[14px] font-semibold">{state.title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') onClose()
          }}
          maxLength={60}
          className="mt-3 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[13px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Compose: ワークスペース（作品）単位で構成を編集・保存する。
 * Vault のカードは全ワークスペース共通のアセット。ここではカード ID と座標・接続・
 * 生成設定（プロット/トーン/プロンプト）だけをワークスペースに保存する（自動保存）。
 */
export function ComposePhase() {
  return (
    <ReactFlowProvider>
      <ComposeInner />
    </ReactFlowProvider>
  )
}

interface AnchorNodeData {
  /** 省略 = card。gap = おまかせスロット（生成時に fill_gap がカードを選ぶ。v1.5） */
  kind?: 'card' | 'gap'
  card?: Card // gap のときは無し
  instruction?: string
  bgmId?: string | null
  targetRole?: CardRole | null // gap の希望ロール
}

/** おまかせスロットノード: 生成時に LLM が在庫から 1 枚選んで埋める */
function GapNode({ data, selected }: NodeProps) {
  const { instruction, bgmId, targetRole } = data as unknown as AnchorNodeData
  return (
    <div
      className={`w-[190px] overflow-hidden rounded-md border border-dashed bg-[var(--bg-canvas)] ${
        selected ? 'border-[var(--accent)]' : 'border-[var(--border-strong)]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-[var(--accent)]" />
      <div className="flex h-[84px] items-center justify-center text-[28px] font-semibold text-[var(--text-faint)]">
        ？
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-[12px] font-medium text-[var(--text-dim)]">おまかせ</div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)]">
            {targetRole ? ROLE_LABELS[targetRole] : 'ロール自動'}
          </span>
          {instruction?.trim() && (
            <span className="text-[var(--text-dim)]" title="この作品での追加指示あり">
              <IconPencil size={10} />
            </span>
          )}
          {bgmId && (
            <span className="text-[var(--text-dim)]" title="BGM を指名">
              <IconMusic size={10} />
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-[var(--accent)]" />
    </div>
  )
}

function AnchorNode({ data, selected }: NodeProps) {
  const { card, instruction, bgmId } = data as unknown as AnchorNodeData
  if (!card) return null
  return (
    <div
      className={`w-[190px] overflow-hidden rounded-md border bg-[var(--bg-card)] ${
        selected ? 'border-[var(--accent)]' : 'border-[var(--border-strong)]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-[var(--accent)]" />
      {card.media_path && (
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
      <div className="px-2.5 py-2">
        <div className="truncate text-[12px] font-medium">{card.title}</div>
        <div className="mt-1 flex items-center gap-1.5">
          {card.role && (
            <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
              {ROLE_LABELS[card.role]}
            </span>
          )}
          {instruction?.trim() && (
            <span className="text-[var(--text-dim)]" title="この作品での追加指示あり">
              <IconPencil size={10} />
            </span>
          )}
          {bgmId && (
            <span className="text-[var(--text-dim)]" title="BGM を指名">
              <IconMusic size={10} />
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-[var(--accent)]" />
    </div>
  )
}

const nodeTypes = { anchor: AnchorNode, gap: GapNode }

/** ワークスペースの graph（ID + 座標 + 指示文）を、実在するカードで React Flow ノードに復元する */
function hydrateGraph(graph: WorkspaceGraph, cardById: Map<string, Card>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  for (const item of graph.nodes ?? []) {
    if (item.kind === 'gap') {
      nodes.push({
        id: item.id,
        type: 'gap',
        position: { x: item.x, y: item.y },
        data: {
          kind: 'gap',
          instruction: item.instruction ?? '',
          bgmId: item.bgm_id ?? null,
          targetRole: item.target_role ?? null
        }
      })
      continue
    }
    const card = cardById.get(item.id)
    if (!card) continue // 削除済みカードのノードは落とす
    nodes.push({
      id: item.id,
      type: 'anchor',
      position: { x: item.x, y: item.y },
      data: { card, instruction: item.instruction ?? '', bgmId: item.bgm_id ?? null }
    })
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: Edge[] = (graph.edges ?? [])
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep' }))
  return { nodes, edges }
}

function serializeGraph(nodes: Node[], edges: Edge[]): WorkspaceGraph {
  return {
    nodes: nodes.map((node) => {
      const data = node.data as unknown as AnchorNodeData
      const isGap = node.type === 'gap'
      return {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        kind: isGap ? ('gap' as const) : ('card' as const),
        instruction: (data.instruction ?? '').trim() || null,
        bgm_id: data.bgmId ?? null,
        target_role: isGap ? (data.targetRole ?? null) : null
      }
    }),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))
  }
}

function ComposeInner() {
  const {
    composition,
    setComposition,
    phase,
    setPhase,
    workspaceId,
    setWorkspaceId,
    composeNodes,
    composeEdges,
    setComposeGraph,
    setPendingGenerate
  } = useAppStore()
  const [allCards, setAllCards] = useState<Card[]>([])
  const [allBgm, setAllBgm] = useState<Bgm[]>([])
  const [allFolders, setAllFolders] = useState<Folder[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [nodes, setNodes, onNodesChange] = useNodesState(composeNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(composeEdges)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [loreOpen, setLoreOpen] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [wsMenu, setWsMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [rightWidth, setRightWidth] = useState(280)
  const [assetHeight, setAssetHeight] = useState(DEFAULT_ASSET_HEIGHT)
  const hydrated = useRef(false)
  const reactFlow = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const fitPendingRef = useRef(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  const cardById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards])

  const applyWorkspace = useCallback(
    (workspace: Workspace, cards: Map<string, Card>) => {
      const { nodes: nextNodes, edges: nextEdges } = hydrateGraph(workspace.graph, cards)
      setNodes(nextNodes)
      setEdges(nextEdges)
      setComposition({
        plot: workspace.plot,
        targetTone: workspace.target_tone ?? '',
        promptPresetId: workspace.prompt_preset_id,
        sceneLength: workspace.scene_length ?? '',
        gapRoute: workspace.gap_route ?? '',
        folderIds: workspace.folder_ids ?? [],
        lore: workspace.lore ?? []
      })
      setWorkspaceId(workspace.id)
      localStorage.setItem(LAST_WORKSPACE_KEY, workspace.id)
      hydrated.current = true
      fitPendingRef.current = true // 読み込んだ作品の全ノードが収まるように表示する
    },
    [setNodes, setEdges, setComposition, setWorkspaceId]
  )

  // 作品を読み込んだ直後は全体をフィット表示する。Compose が非表示（display:none）の間は
  // フィットできない（キャンバスのサイズが 0）ため、タブが表示されるまで持ち越す。
  // ノードのサイズ測定を待ってから 1 フレーム遅らせて実行する
  useEffect(() => {
    if (!fitPendingRef.current || phase !== 'compose') return
    if (nodes.length > 0 && !nodesInitialized) return
    fitPendingRef.current = false
    if (nodes.length === 0) return
    window.setTimeout(() => void reactFlow.fitView({ padding: 0.15, duration: 300 }), 0)
  }, [phase, nodes, nodesInitialized, reactFlow])

  // 初期化: カード + ワークスペース一覧を読み、前回のワークスペース（無ければ作成）を開く
  useEffect(() => {
    let canceled = false
    void (async () => {
      try {
        const [cardsResult, workspacesResult, prompts, bgmResult, foldersResult] = await Promise.all([
          api.listCards(),
          api.listWorkspaces(),
          api.getPromptConfig('writer').catch(() => null),
          api.listBgm().catch(() => ({ bgm: [] as Bgm[] })),
          api.listFolders().catch(() => ({ folders: [] as Folder[], root_count: 0 }))
        ])
        if (canceled) return
        setAllCards(cardsResult.cards)
        setAllBgm(bgmResult.bgm)
        setAllFolders(foldersResult.folders)
        setPromptConfig(prompts)
        const cards = new Map(cardsResult.cards.map((card) => [card.id, card]))

        let list = workspacesResult.workspaces
        if (list.length === 0) {
          const created = await api.createWorkspace('無題の作品')
          list = [{ ...created, story_count: 0 }]
        }
        setWorkspaces(list)

        // すでに読み込み済み（タブ復帰）なら再ハイドレートしない
        if (hydrated.current && workspaceId && list.some((item) => item.id === workspaceId)) return

        const lastId = localStorage.getItem(LAST_WORKSPACE_KEY)
        const targetId = list.find((item) => item.id === lastId)?.id ?? list[0].id
        const workspace = await api.getWorkspace(targetId)
        if (!canceled) applyWorkspace(workspace, cards)
      } catch (error) {
        console.error('[compose] init failed:', error)
      }
    })()
    return () => {
      canceled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // store へキャッシュ（Generate がアンカー列の導出に使う）
  useEffect(() => {
    setComposeGraph(nodes, edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  // タブが表示されたらアセット類を再取得する（常時マウントのため、マウント時の初期化だけでは
  // Vault でのカード追加・編集・削除やプリセット変更に追随できない）。グラフは再ハイドレート
  // せず、既存ノードのカード情報だけ更新し、削除済みカードのノードは落とす
  useEffect(() => {
    if (phase !== 'compose' || !hydrated.current) return
    void (async () => {
      try {
        const [cardsResult, bgmResult, prompts, foldersResult] = await Promise.all([
          api.listCards(),
          api.listBgm().catch(() => ({ bgm: [] as Bgm[] })),
          api.getPromptConfig('writer').catch(() => null),
          api.listFolders().catch(() => null)
        ])
        setAllCards(cardsResult.cards)
        setAllBgm(bgmResult.bgm)
        if (prompts) setPromptConfig(prompts)
        if (foldersResult) setAllFolders(foldersResult.folders)
        const fresh = new Map(cardsResult.cards.map((card) => [card.id, card]))
        // gap ノードはカードではないので削除判定の対象外
        const alive = (id: string) => id.startsWith('gap-') || fresh.has(id)
        setNodes((prev) => {
          const next = prev
            .filter((node) => alive(node.id))
            .map((node) => {
              if (node.type === 'gap') return node
              const data = node.data as unknown as AnchorNodeData
              const card = fresh.get(node.id)!
              return data.card?.updated_at === card.updated_at ? node : { ...node, data: { ...data, card } }
            })
          const unchanged = next.length === prev.length && next.every((node, i) => node === prev[i])
          return unchanged ? prev : next
        })
        setEdges((prev) => {
          const next = prev.filter((edge) => alive(edge.source) && alive(edge.target))
          return next.length === prev.length ? prev : next
        })
        void refreshWorkspaces()
      } catch {
        // ベストエフォート（次の表示時に再試行される）
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // 「⋯」メニューは Escape で閉じる
  useEffect(() => {
    if (!wsMenu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWsMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wsMenu])

  const buildUpdatePayload = useCallback(() => {
    return {
      graph: serializeGraph(nodes, edges),
      plot: composition.plot,
      folder_ids: composition.folderIds,
      lore: composition.lore,
      ...(composition.targetTone ? { target_tone: composition.targetTone as CardTone } : { clear_target_tone: true }),
      ...(composition.promptPresetId
        ? { prompt_preset_id: composition.promptPresetId }
        : { clear_prompt_preset: true }),
      ...(composition.sceneLength
        ? { scene_length: composition.sceneLength as SceneLength }
        : { clear_scene_length: true }),
      ...(composition.gapRoute ? { gap_route: composition.gapRoute as GapRoute } : { clear_gap_route: true })
    }
  }, [nodes, edges, composition])

  // 自動保存（デバウンス）
  useEffect(() => {
    if (!hydrated.current || !workspaceId) return
    const timer = setTimeout(() => {
      setSaveState('saving')
      api
        .updateWorkspace(workspaceId, buildUpdatePayload())
        .then(() => {
          setSaveState('saved')
          reportStatusAction('作品の変更を保存しました')
        })
        .catch(() => {
          setSaveState('error')
          reportStatusAction('作品の保存に失敗しました', 'error')
        })
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [workspaceId, buildUpdatePayload])

  const refreshWorkspaces = useCallback(async () => {
    try {
      setWorkspaces((await api.listWorkspaces()).workspaces)
    } catch {
      // 一覧更新失敗は致命ではない
    }
  }, [])

  const switchWorkspace = async (targetId: string) => {
    if (targetId === workspaceId) return
    try {
      if (workspaceId && hydrated.current) {
        await api.updateWorkspace(workspaceId, buildUpdatePayload()) // 切替前に確実に保存
      }
      const workspace = await api.getWorkspace(targetId)
      applyWorkspace(workspace, cardById)
      void refreshWorkspaces()
    } catch (error) {
      console.error('[compose] switch failed:', error)
    }
  }

  const handleCreate = () => {
    setNameDialog({
      title: '新しい作品の名前',
      defaultValue: '無題の作品',
      onSubmit: (name) => {
        void api.createWorkspace(name).then((created) => {
          applyWorkspace(created, cardById)
          void refreshWorkspaces()
        })
      }
    })
  }

  // ワークスペース行の「⋯」メニュー（lm-chat 風。名前変更 / 複製 / 削除）
  const renameWorkspaceById = (ws: { id: string; name: string }) => {
    setWsMenu(null)
    setNameDialog({
      title: '作品名を変更',
      defaultValue: ws.name,
      onSubmit: (name) => {
        void api.updateWorkspace(ws.id, { name }).then(() => void refreshWorkspaces())
      }
    })
  }

  const duplicateWorkspaceById = (ws: { id: string; name: string }) => {
    setWsMenu(null)
    setNameDialog({
      title: '複製後の名前',
      defaultValue: `${ws.name} のコピー`,
      onSubmit: (name) => {
        void (async () => {
          // アクティブな作品は最新の編集内容を保存してから複製する
          if (ws.id === workspaceId) await api.updateWorkspace(workspaceId, buildUpdatePayload())
          const duplicated = await api.duplicateWorkspace(ws.id, name)
          applyWorkspace(duplicated, cardById)
          void refreshWorkspaces()
        })()
      }
    })
  }

  const deleteWorkspaceById = async (ws: { id: string; name: string }) => {
    setWsMenu(null)
    if (!window.confirm(`作品「${ws.name}」を削除しますか？（生成済みの物語は残ります）`)) return
    await api.deleteWorkspace(ws.id)
    const rest = (await api.listWorkspaces()).workspaces
    setWorkspaces(rest)
    // 表示中の作品を消したときだけ別の作品へ切り替える（無ければ新規作成）
    if (ws.id === workspaceId) {
      hydrated.current = false
      if (rest.length === 0) {
        const created = await api.createWorkspace('無題の作品')
        setWorkspaces([{ ...created, story_count: 0 }])
        applyWorkspace(created, cardById)
      } else {
        const workspace = await api.getWorkspace(rest[0].id)
        applyWorkspace(workspace, cardById)
      }
    }
  }

  const placedIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  // アセット = ルート（共有）+ この作品で使うフォルダ（サブツリー含む）の未配置カード
  const allowedFolderIds = useMemo(
    () => expandFolderSelection(allFolders, composition.folderIds),
    [allFolders, composition.folderIds]
  )
  const palette = allCards.filter(
    (card) =>
      !placedIds.has(card.id) && (card.folder_id === null || allowedFolderIds.has(card.folder_id))
  )
  const chain = useMemo(() => computeChain(nodes, edges), [nodes, edges])
  const selectedNode = nodes.find((node) => node.selected)
  const selectedNodeData = selectedNode ? (selectedNode.data as unknown as AnchorNodeData) : null
  // アセットエリアで選択中のカード（配置済み・削除済みになったら自動で外れる）
  const selectedAsset =
    selectedAssetId && !placedIds.has(selectedAssetId) ? (cardById.get(selectedAssetId) ?? null) : null

  // アセットのクリック = 選択（プロパティ表示）。キャンバス側のノード選択とパネルを取り合わない
  // よう、アセットを選んだらノードの選択は外す（表示はノード優先のため）
  const selectAsset = (cardId: string) => {
    setSelectedAssetId(cardId)
    setNodes((prev) =>
      prev.some((node) => node.selected) ? prev.map((node) => (node.selected ? { ...node, selected: false } : node)) : prev
    )
  }

  // 現在のビューポート（カメラ）中央の空き位置（既存ノードと重なる場合はずらす）
  const nextFreePosition = () => {
    let position = { x: 120, y: 120 }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) {
      const center = reactFlow.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      })
      position = { x: center.x - 95, y: center.y - 70 } // ノード（幅 190）の中心を合わせる
    }
    while (nodes.some((node) => Math.abs(node.position.x - position.x) < 24 && Math.abs(node.position.y - position.y) < 24)) {
      position = { x: position.x + 28, y: position.y + 28 }
    }
    return position
  }

  const addCardNode = (card: Card, position?: { x: number; y: number }) => {
    setNodes((prev) => [
      ...prev,
      { id: card.id, type: 'anchor', position: position ?? nextFreePosition(), data: { card, instruction: '' } }
    ])
  }

  // おまかせスロット（v1.5 穴埋め）: 生成時に LLM が在庫から 1 枚選んで埋める
  const addGapNode = (position?: { x: number; y: number }) => {
    setNodes((prev) => [
      ...prev,
      {
        id: `gap-${crypto.randomUUID()}`,
        type: 'gap',
        position: position ?? nextFreePosition(),
        data: { kind: 'gap', instruction: '', bgmId: null, targetRole: null }
      }
    ])
  }

  // キャンバスのショートカット: A = ネットワーク全体を表示 / F = 選択中のノードにフォーカス。
  // ノードを選択していなくても効くよう window で拾う（Compose 表示中のみ。
  // 入力欄へのタイプ中・修飾キー押下時は無視）
  useEffect(() => {
    if (phase !== 'compose') return
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

  // アセットエリアからのドラッグ&ドロップ配置（ドロップ位置にノードの中心を合わせる）
  const onCanvasDragOver = (event: React.DragEvent) => {
    const types = event.dataTransfer.types
    if (types.includes(CARD_DND_TYPE) || types.includes(GAP_DND_TYPE)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }

  const onCanvasDrop = (event: React.DragEvent) => {
    const cardId = event.dataTransfer.getData(CARD_DND_TYPE)
    const isGap = event.dataTransfer.types.includes(GAP_DND_TYPE)
    if (!cardId && !isGap) return
    event.preventDefault()
    const center = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const position = { x: center.x - 95, y: center.y - 70 } // ノード（幅 190）の中心を合わせる
    if (cardId) {
      const card = cardById.get(cardId)
      if (!card || placedIds.has(card.id)) return
      addCardNode(card, position)
    } else {
      addGapNode(position)
    }
  }

  const updateNodeInstruction = (nodeId: string, instruction: string) => {
    setNodes((prev) =>
      prev.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, instruction } } : node))
    )
  }

  const updateNodeBgm = (nodeId: string, bgmId: string | null) => {
    setNodes((prev) =>
      prev.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, bgmId } } : node))
    )
  }

  const updateNodeTargetRole = (nodeId: string, targetRole: CardRole | null) => {
    setNodes((prev) =>
      prev.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, targetRole } } : node))
    )
  }

  // 一本鎖の制約: 出力・入力とも 1 本まで、循環は禁止
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return
      setEdges((prev) => {
        if (prev.some((edge) => edge.source === connection.source)) return prev
        if (prev.some((edge) => edge.target === connection.target)) return prev
        const nextOf = new Map(prev.map((edge) => [edge.source, edge.target]))
        let cursor: string | undefined = connection.target ?? undefined
        while (cursor) {
          if (cursor === connection.source) return prev // 循環
          cursor = nextOf.get(cursor)
        }
        return addEdge({ ...connection, type: 'smoothstep' }, prev)
      })
    },
    [setEdges]
  )

  // 生成へ: 保存を確定してから Generate タブで自動開始。
  // アンカー列は Generate 側が store のグラフから導出する（スナップショットを渡さない）
  const handleGenerate = async () => {
    if (!chain.orderedIds || !workspaceId) return
    try {
      await api.updateWorkspace(workspaceId, buildUpdatePayload())
    } catch {
      // 保存失敗でも生成は続行できる（次の自動保存でリトライされる）
    }
    setPendingGenerate(true)
    setPhase('generate')
  }

  const inputClass =
    'w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  // ドラッグでのリサイズ共通処理。delta（開始点からの移動量）→ 新しいサイズを反映する
  const startResize = (
    event: React.PointerEvent,
    axis: 'x' | 'y',
    apply: (delta: number) => void
  ) => {
    event.preventDefault()
    const start = axis === 'x' ? event.clientX : event.clientY
    const onMove = (ev: PointerEvent) => apply((axis === 'x' ? ev.clientX : ev.clientY) - start)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  const startSidebarResize = (event: React.PointerEvent) => {
    const startWidth = sidebarWidth
    startResize(event, 'x', (delta) => setSidebarWidth(clamp(startWidth + delta, 180, 480)))
  }
  const startRightResize = (event: React.PointerEvent) => {
    const startWidth = rightWidth
    startResize(event, 'x', (delta) => setRightWidth(clamp(startWidth - delta, 220, 520)))
  }
  const startAssetResize = (event: React.PointerEvent) => {
    const startHeight = assetHeight
    startResize(event, 'y', (delta) => setAssetHeight(clamp(startHeight - delta, 90, 400)))
  }

  return (
    <div className="relative flex h-full">
      {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} />}
      {loreOpen && (
        <LoreEditor
          lore={composition.lore}
          onChange={(lore) => setComposition({ ...composition, lore })}
          onClose={() => setLoreOpen(false)}
        />
      )}

      {/* 左: 作品（ワークスペース）一覧 */}
      <aside
        style={{ width: sidebarWidth }}
        className="flex shrink-0 flex-col bg-[var(--bg-sidebar)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
          <span className="text-[13px] font-semibold text-[var(--text-dim)]">作品</span>
          <div className="flex items-center gap-2">
            <span
              className={`text-[11px] ${saveState === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-faint)]'}`}
            >
              {saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失敗' : '保存済み'}
            </span>
            <button
              onClick={handleCreate}
              aria-label="新しい作品"
              title="新しい作品"
              className="flex items-center rounded border border-[var(--border-strong)] p-1 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
            >
              <IconPlus size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 ${
                workspace.id === workspaceId
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                  : 'border-transparent hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <button
                onClick={() => void switchWorkspace(workspace.id)}
                className="min-w-0 flex-1 text-left"
                title={workspace.name}
              >
                <span className="block truncate text-[13px]">{workspace.name}</span>
                {workspace.story_count > 0 && (
                  <span className="block text-[10px] text-[var(--text-faint)]">{workspace.story_count} 話</span>
                )}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  const rect = event.currentTarget.getBoundingClientRect()
                  setWsMenu({ id: workspace.id, name: workspace.name, x: rect.right, y: rect.bottom + 4 })
                }}
                aria-label="メニュー"
                title="メニュー"
                className={`flex shrink-0 items-center rounded p-1 text-[var(--text-faint)] hover:bg-[var(--bg-card)] hover:text-[var(--text)] ${
                  wsMenu?.id === workspace.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <IconMore size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 左サイドの幅リサイズ（見た目は 1px・当たり判定は広め） */}
      <div className="group relative w-px shrink-0 bg-[var(--border)]">
        <div
          onPointerDown={startSidebarResize}
          title="ドラッグで幅を変更"
          className="absolute inset-y-0 -left-1 -right-1 z-10 cursor-col-resize"
        />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-[var(--accent-border)] opacity-0 group-hover:opacity-100" />
      </div>

      {/* 中央: ノードネットワーク + 下部アセットエリア */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={canvasRef}
          className="relative min-h-0 flex-1"
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            deleteKeyCode={['Delete', 'Backspace']}
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
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={(node) => (node.selected ? '#7c5af7' : '#2e3140')}
              nodeStrokeColor={(node) => (node.selected ? '#7c5af7' : '#3a3e4f')}
              nodeStrokeWidth={2}
              nodeBorderRadius={4}
              maskColor="rgba(13, 15, 20, 0.6)"
              maskStrokeColor="rgba(124, 90, 247, 0.35)"
              maskStrokeWidth={1}
              bgColor="#111318"
              style={{ border: '1px solid #252830', borderRadius: 10 }}
              className="!m-3 overflow-hidden !rounded-[10px] shadow-lg"
            />
          </ReactFlow>

          {/* ステータス */}
          <div className="absolute left-3 top-3 rounded-md border border-[var(--border)] bg-[var(--bg-sidebar)]/95 px-3 py-2 text-[12px] text-[var(--text-dim)]">
            {chain.orderedIds ? `${chain.orderedIds.length} シーン（左から順に清書）` : chain.reason}
          </div>
        </div>

        {/* アセットエリアの高さリサイズ（見た目は 1px・当たり判定は広め） */}
        <div className="group relative h-px shrink-0 bg-[var(--border)]">
          <div
            onPointerDown={startAssetResize}
            title="ドラッグで高さを変更"
            className="absolute inset-x-0 -top-1 -bottom-1 z-10 cursor-row-resize"
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--accent-border)] opacity-0 group-hover:opacity-100" />
        </div>

        {/* アセットエリア: 未配置カードをクリックで配置 */}
        <div
          style={{ height: assetHeight }}
          className="flex shrink-0 flex-col bg-[var(--bg-sidebar)]"
        >
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-[12px] font-semibold text-[var(--text-dim)]">
              アセット（ドラッグでキャンバスに配置。クリックで内容を確認）
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-2">
            {/* 先頭常設: おまかせスロット疑似カード（配置しても消えない。何個でも置ける） */}
            <button
              onClick={() => selectAsset(GAP_ASSET_ID)}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(GAP_DND_TYPE, '1')
                event.dataTransfer.effectAllowed = 'move'
              }}
              title="生成時に LLM が在庫から 1 枚選んで埋めるスロット（何個でも配置可。始点・終点にはできません）"
              className={`flex w-28 shrink-0 cursor-grab flex-col overflow-hidden rounded-md border border-dashed text-left active:cursor-grabbing ${
                selectedAssetId === GAP_ASSET_ID
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border-strong)] bg-[var(--bg-card)] hover:border-[var(--accent-border)]'
              }`}
            >
              <span className="flex h-16 w-full items-center justify-center bg-[var(--bg-canvas)] text-[20px] text-[var(--text-faint)]">
                ？
              </span>
              <span className="truncate px-1.5 py-1 text-[11px] text-[var(--text-dim)]">おまかせスロット</span>
            </button>
            {palette.length === 0 ? (
              <div className="py-4 text-[12px] text-[var(--text-faint)]">
                {allCards.length === 0 ? 'Vault でカードを登録してください。' : 'すべて配置済みです。'}
              </div>
            ) : (
              palette.map((card) => (
                <button
                  key={card.id}
                  onClick={() => selectAsset(card.id)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(CARD_DND_TYPE, card.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  title={card.title}
                  className={`flex w-28 shrink-0 cursor-grab flex-col overflow-hidden rounded-md border text-left active:cursor-grabbing ${
                    card.id === selectedAssetId
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <span className="relative block h-16 w-full bg-[var(--bg-canvas)]">
                    {card.media_path ? (
                      <>
                        <img
                          src={`${cardFileUrl(card.id, true)}&v=${encodeURIComponent(card.updated_at)}`}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                          onError={(event) => {
                            event.currentTarget.style.visibility = 'hidden'
                          }}
                        />
                        {card.media_type === 'video' && (
                          <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 p-0.5 text-white/90">
                            <IconFilm size={9} />
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[var(--text-faint)] opacity-40">
                        <IconFile size={18} />
                      </span>
                    )}
                  </span>
                  <span className="truncate px-1.5 py-1 text-[11px]">{card.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ワークスペースの「⋯」メニュー */}
      {wsMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setWsMenu(null)} />
          <div
            className="fixed z-50 min-w-[140px] -translate-x-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-sidebar)] py-1 shadow-xl"
            style={{ left: wsMenu.x, top: wsMenu.y }}
          >
            <button
              onClick={() => renameWorkspaceById(wsMenu)}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
            >
              名前を変更
            </button>
            <button
              onClick={() => duplicateWorkspaceById(wsMenu)}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
            >
              複製
            </button>
            <button
              onClick={() => void deleteWorkspaceById(wsMenu)}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-elevated)]"
            >
              削除
            </button>
          </div>
        </>
      )}

      {/* 右サイドの幅リサイズ（見た目は 1px・当たり判定は広め） */}
      <div className="group relative w-px shrink-0 bg-[var(--border)]">
        <div
          onPointerDown={startRightResize}
          title="ドラッグで幅を変更"
          className="absolute inset-y-0 -left-1 -right-1 z-10 cursor-col-resize"
        />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-[var(--accent-border)] opacity-0 group-hover:opacity-100" />
      </div>

      {/* 生成設定 + 選択ノードのプロパティ */}
      <aside
        style={{ width: rightWidth }}
        className="flex shrink-0 flex-col bg-[var(--bg-sidebar)]"
      >
        {selectedNode && selectedNodeData && (
          <div className="border-b border-[var(--border)]">
            <div className="px-3 py-2.5 text-[13px] font-semibold text-[var(--text-dim)]">ノードのプロパティ</div>
            <div className="space-y-2 px-3 pb-3">
              {selectedNodeData.card ? (
                <>
                  <div className="flex items-center gap-2">
                    {selectedNodeData.card.media_path && (
                      <img
                        src={cardFileUrl(selectedNodeData.card.id, true)}
                        alt=""
                        className="h-9 w-12 shrink-0 rounded object-cover"
                        onError={(event) => {
                          event.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                    )}
                    <span className="min-w-0 truncate text-[13px] font-medium">{selectedNodeData.card.title}</span>
                  </div>
                  <p className="max-h-16 overflow-y-auto text-[11px] leading-relaxed text-[var(--text-faint)]">
                    {selectedNodeData.card.brief}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded border border-dashed border-[var(--border-strong)] text-[15px] text-[var(--text-faint)]">
                      ？
                    </span>
                    <span className="min-w-0 truncate text-[13px] font-medium">おまかせスロット</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
                    生成時に、前後のシーンの流れに合うカードを在庫から LLM が 1 枚選んで埋めます。
                  </p>
                  <label className="block">
                    <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
                      希望ロール（任意。近いカードが優先されやすくなる）
                    </span>
                    <select
                      value={selectedNodeData.targetRole ?? ''}
                      onChange={(event) =>
                        updateNodeTargetRole(selectedNode.id, (event.target.value || null) as CardRole | null)
                      }
                      className={inputClass}
                    >
                      <option value="">自動（指定しない）</option>
                      {(Object.keys(ROLE_LABELS) as CardRole[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="block">
                <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
                  この作品での追加指示（任意。清書時にブリーフへ加えられる）
                </span>
                <textarea
                  value={selectedNodeData.instruction ?? ''}
                  onChange={(event) => updateNodeInstruction(selectedNode.id, event.target.value)}
                  rows={4}
                  placeholder="例: ここは回想として書く。雨の描写を引きずる。"
                  className={`${inputClass} leading-relaxed`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
                  BGM（自動 = LLM が雰囲気で選曲。指名すると固定）
                </span>
                <select
                  value={selectedNodeData.bgmId ?? ''}
                  onChange={(event) => updateNodeBgm(selectedNode.id, event.target.value || null)}
                  className={inputClass}
                >
                  <option value="">自動（指定しない）</option>
                  {allBgm.map((bgm) => (
                    <option key={bgm.id} value={bgm.id}>
                      {bgm.title}
                    </option>
                  ))}
                </select>
                {allBgm.length === 0 && (
                  <span className="mt-1 block text-[11px] text-[var(--text-faint)]">
                    Vault の BGM タブで曲を登録できます
                  </span>
                )}
              </label>
            </div>
          </div>
        )}

        {/* アセットエリアで選択中のおまかせスロット（ノード選択が無いときだけ表示） */}
        {!selectedNode && selectedAssetId === GAP_ASSET_ID && (
          <div className="border-b border-[var(--border)]">
            <div className="px-3 py-2.5 text-[13px] font-semibold text-[var(--text-dim)]">おまかせスロット</div>
            <div className="space-y-2 px-3 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded border border-dashed border-[var(--border-strong)] text-[15px] text-[var(--text-faint)]">
                  ？
                </span>
                <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--text-faint)]">
                  生成時に、前後のシーンの流れに合うカードを在庫から LLM が 1 枚選んで埋めます。
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
                何個でも配置できます（始点・終点は不可）。希望ロール・追加指示・BGM の指名は、
                配置したノードを選択してプロパティで設定します。
              </p>
              <button
                onClick={() => addGapNode()}
                className="w-full rounded border border-[var(--border-strong)] px-2 py-1.5 text-[12px] text-[var(--text-dim)] hover:border-[var(--accent-border)] hover:text-[var(--text)]"
              >
                キャンバスに配置
              </button>
              <p className="text-[11px] text-[var(--text-faint)]">
                アセットからキャンバスへ直接ドラッグでも配置できます。
              </p>
            </div>
          </div>
        )}

        {/* アセットエリアで選択中のカード（ノード選択が無いときだけ表示） */}
        {!selectedNode && selectedAsset && (
          <div className="border-b border-[var(--border)]">
            <div className="px-3 py-2.5 text-[13px] font-semibold text-[var(--text-dim)]">カードのプロパティ</div>
            <div className="space-y-2 px-3 pb-3">
              {selectedAsset.media_path && (
                <div className="relative overflow-hidden rounded bg-[var(--bg-canvas)]">
                  <img
                    src={`${cardFileUrl(selectedAsset.id, true)}&v=${encodeURIComponent(selectedAsset.updated_at)}`}
                    alt=""
                    className="block h-auto max-h-40 w-full object-contain"
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                  {selectedAsset.media_type === 'video' && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/60 p-0.5 text-white/90">
                      <IconFilm size={11} />
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{selectedAsset.title}</span>
                {selectedAsset.role && (
                  <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
                    {ROLE_LABELS[selectedAsset.role]}
                  </span>
                )}
              </div>
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-faint)]">
                {selectedAsset.brief || '（ブリーフ未記入）'}
              </p>
              <button
                onClick={() => addCardNode(selectedAsset)}
                className="w-full rounded border border-[var(--border-strong)] px-2 py-1.5 text-[12px] text-[var(--text-dim)] hover:border-[var(--accent-border)] hover:text-[var(--text)]"
              >
                キャンバスに配置
              </button>
              <p className="text-[11px] text-[var(--text-faint)]">
                アセットからキャンバスへ直接ドラッグでも配置できます。編集は Vault で行えます。
              </p>
            </div>
          </div>
        )}

        <div className="border-b border-[var(--border)] px-3 py-2.5 text-[13px] font-semibold text-[var(--text-dim)]">
          生成設定
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">プロット（物語全体の方向づけ。任意）</span>
            <textarea
              value={composition.plot}
              onChange={(event) => setComposition({ ...composition, plot: event.target.value })}
              rows={4}
              className={`${inputClass} leading-relaxed`}
            />
          </label>

          <div className="block">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
              背景設定（世界観・人物などの恒久設定。清書時に参照される）
            </span>
            <button
              onClick={() => setLoreOpen(true)}
              className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-left text-[13px] text-[var(--text-dim)] hover:border-[var(--accent-border)] hover:text-[var(--text)]"
            >
              {composition.lore.length > 0 ? `${composition.lore.length} 件のメモを編集…` : 'メモを追加…'}
            </button>
          </div>

          <label className="block">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">目標トーン（結末の着地。任意）</span>
            <select
              value={composition.targetTone}
              onChange={(event) => setComposition({ ...composition, targetTone: event.target.value as CardTone | '' })}
              className={inputClass}
            >
              {TONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">シーンの長さ</span>
            <select
              value={composition.sceneLength}
              onChange={(event) =>
                setComposition({ ...composition, sceneLength: event.target.value as SceneLength | '' })
              }
              className={inputClass}
            >
              {SCENE_LENGTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
              おまかせの経路（連続するおまかせスロットの進み方）
            </span>
            <select
              value={composition.gapRoute}
              onChange={(event) => setComposition({ ...composition, gapRoute: event.target.value as GapRoute | '' })}
              className={inputClass}
            >
              {GAP_ROUTE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {allFolders.length > 0 && (
            <div className="block">
              <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
                使うフォルダ（ルートの素材は常に使用。選択はサブフォルダも含む）
              </span>
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded border border-[var(--border-strong)] bg-[var(--bg-input)] p-1.5">
                {flattenTree(allFolders).map(({ folder, depth }) => (
                  <label
                    key={folder.id}
                    style={{ paddingLeft: 4 + depth * 14 }}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
                  >
                    <input
                      type="checkbox"
                      checked={composition.folderIds.includes(folder.id)}
                      onChange={(event) =>
                        setComposition({
                          ...composition,
                          folderIds: event.target.checked
                            ? [...composition.folderIds, folder.id]
                            : composition.folderIds.filter((id) => id !== folder.id)
                        })
                      }
                      className="accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    {folder.card_count > 0 && (
                      <span className="text-[10px] text-[var(--text-faint)]">{folder.card_count}</span>
                    )}
                  </label>
                ))}
              </div>
              <span className="mt-1 block text-[11px] text-[var(--text-faint)]">
                おまかせスロットの選定と下のアセット一覧が、ルート + 選択フォルダに絞られます
              </span>
            </div>
          )}

          {promptConfig && (
            <label className="block">
              <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
                清書プロンプト（追加・編集は ⚙ 設定から）
              </span>
              <select
                value={composition.promptPresetId ?? ''}
                onChange={(event) =>
                  setComposition({ ...composition, promptPresetId: event.target.value || null })
                }
                className={inputClass}
              >
                <option value="">既定</option>
                {promptConfig.presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="border-t border-[var(--border)] p-3">
          <button
            onClick={() => void handleGenerate()}
            disabled={!chain.orderedIds || !workspaceId}
            className="w-full rounded bg-[var(--accent)] px-4 py-2.5 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            生成する →
          </button>
          {!chain.orderedIds && (
            <div className="mt-1.5 text-center text-[11px] text-[var(--text-faint)]">{chain.reason}</div>
          )}
        </div>
      </aside>
    </div>
  )
}
