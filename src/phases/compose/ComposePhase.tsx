import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  api,
  cardFileUrl,
  type Card,
  type CardRole,
  type CardTone,
  type PromptConfig,
  type SceneLength,
  type Workspace,
  type WorkspaceGraph,
  type WorkspaceSummary
} from '../../lib/api'
import { useAppStore } from '../../store/appStore'

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

const SCENE_LENGTH_OPTIONS: Array<{ value: SceneLength | ''; label: string }> = [
  { value: '', label: '指定なし（プロンプト任せ）' },
  { value: 'short', label: '短め（約 150 字）' },
  { value: 'standard', label: '標準（約 300 字）' },
  { value: 'long', label: '長め（約 600 字）' }
]

const LAST_WORKSPACE_KEY = 'story-flow:last-workspace'
const AUTOSAVE_DELAY_MS = 800

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

function AnchorNode({ data, selected }: NodeProps) {
  const card = (data as { card: Card }).card
  return (
    <div
      className={`w-[190px] overflow-hidden rounded-md border bg-[var(--bg-card)] ${
        selected ? 'border-[var(--accent)]' : 'border-[var(--border-strong)]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-[var(--accent)]" />
      {card.media_path && (
        <div className="relative h-[84px] overflow-hidden bg-[var(--bg-canvas)]">
          <img
            src={cardFileUrl(card.id, true)}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
          {card.media_type === 'video' && (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[10px]">🎬</span>
          )}
        </div>
      )}
      <div className="px-2.5 py-2">
        <div className="truncate text-[12px] font-medium">{card.title}</div>
        <span className="mt-1 inline-block rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
          {ROLE_LABELS[card.role]}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-[var(--accent)]" />
    </div>
  )
}

const nodeTypes = { anchor: AnchorNode }

/** エッジ列から一本鎖の並び順を求める。成立しなければ理由を返す */
function computeChain(nodes: Node[], edges: Edge[]): { orderedIds: string[] | null; reason: string | null } {
  if (nodes.length === 0) return { orderedIds: null, reason: 'カードを置いてください' }
  if (nodes.length === 1) return { orderedIds: [nodes[0].id], reason: null }

  const nextOf = new Map(edges.map((edge) => [edge.source, edge.target]))
  const hasIncoming = new Set(edges.map((edge) => edge.target))
  const starts = nodes.filter((node) => !hasIncoming.has(node.id))

  if (starts.length !== 1) {
    return { orderedIds: null, reason: 'すべてのカードを一本の線で繋いでください（始点が複数あります）' }
  }
  const ordered: string[] = []
  let current: string | undefined = starts[0].id
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    ordered.push(current)
    current = nextOf.get(current)
  }
  if (ordered.length !== nodes.length) {
    return { orderedIds: null, reason: `繋がっていないカードが ${nodes.length - ordered.length} 枚あります` }
  }
  return { orderedIds: ordered, reason: null }
}

/** ワークスペースの graph（ID + 座標）を、実在するカードで React Flow ノードに復元する */
function hydrateGraph(graph: WorkspaceGraph, cardById: Map<string, Card>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  for (const item of graph.nodes ?? []) {
    const card = cardById.get(item.id)
    if (!card) continue // 削除済みカードのノードは落とす
    nodes.push({ id: item.id, type: 'anchor', position: { x: item.x, y: item.y }, data: { card } })
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: Edge[] = (graph.edges ?? [])
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep' }))
  return { nodes, edges }
}

function serializeGraph(nodes: Node[], edges: Edge[]): WorkspaceGraph {
  return {
    nodes: nodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))
  }
}

function ComposeInner() {
  const {
    composition,
    setComposition,
    setPhase,
    workspaceId,
    setWorkspaceId,
    composeNodes,
    composeEdges,
    setComposeGraph,
    setPendingGenerate
  } = useAppStore()
  const [allCards, setAllCards] = useState<Card[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [nodes, setNodes, onNodesChange] = useNodesState(composeNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(composeEdges)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const hydrated = useRef(false)

  const cardById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards])

  const applyWorkspace = useCallback(
    (workspace: Workspace, cards: Map<string, Card>) => {
      const { nodes: nextNodes, edges: nextEdges } = hydrateGraph(workspace.graph, cards)
      setNodes(nextNodes)
      setEdges(nextEdges)
      setComposition({
        anchorCardIds: [],
        plot: workspace.plot,
        targetTone: workspace.target_tone ?? '',
        promptPresetId: workspace.prompt_preset_id,
        sceneLength: workspace.scene_length ?? ''
      })
      setWorkspaceId(workspace.id)
      localStorage.setItem(LAST_WORKSPACE_KEY, workspace.id)
      hydrated.current = true
    },
    [setNodes, setEdges, setComposition, setWorkspaceId]
  )

  // 初期化: カード + ワークスペース一覧を読み、前回のワークスペース（無ければ作成）を開く
  useEffect(() => {
    let canceled = false
    void (async () => {
      try {
        const [cardsResult, workspacesResult, prompts] = await Promise.all([
          api.listCards(),
          api.listWorkspaces(),
          api.getPromptConfig('writer').catch(() => null)
        ])
        if (canceled) return
        setAllCards(cardsResult.cards)
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

  // store へキャッシュ（タブ切替対策）
  useEffect(() => {
    setComposeGraph(nodes, edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const buildUpdatePayload = useCallback(() => {
    return {
      graph: serializeGraph(nodes, edges),
      plot: composition.plot,
      ...(composition.targetTone ? { target_tone: composition.targetTone as CardTone } : { clear_target_tone: true }),
      ...(composition.promptPresetId
        ? { prompt_preset_id: composition.promptPresetId }
        : { clear_prompt_preset: true }),
      ...(composition.sceneLength
        ? { scene_length: composition.sceneLength as SceneLength }
        : { clear_scene_length: true })
    }
  }, [nodes, edges, composition])

  // 自動保存（デバウンス）
  useEffect(() => {
    if (!hydrated.current || !workspaceId) return
    const timer = setTimeout(() => {
      setSaveState('saving')
      api
        .updateWorkspace(workspaceId, buildUpdatePayload())
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'))
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

  const handleRename = () => {
    if (!workspaceId) return
    const current = workspaces.find((item) => item.id === workspaceId)
    setNameDialog({
      title: '作品名を変更',
      defaultValue: current?.name ?? '',
      onSubmit: (name) => {
        void api.updateWorkspace(workspaceId, { name }).then(() => void refreshWorkspaces())
      }
    })
  }

  const handleDuplicate = () => {
    if (!workspaceId) return
    const current = workspaces.find((item) => item.id === workspaceId)
    setNameDialog({
      title: '複製後の名前',
      defaultValue: `${current?.name ?? '作品'} のコピー`,
      onSubmit: (name) => {
        void (async () => {
          await api.updateWorkspace(workspaceId, buildUpdatePayload()) // 最新状態を複製できるよう保存
          const duplicated = await api.duplicateWorkspace(workspaceId, name)
          applyWorkspace(duplicated, cardById)
          void refreshWorkspaces()
        })()
      }
    })
  }

  const handleDelete = async () => {
    if (!workspaceId) return
    const current = workspaces.find((item) => item.id === workspaceId)
    if (!window.confirm(`作品「${current?.name ?? ''}」を削除しますか？（生成済みの物語は残ります）`)) return
    await api.deleteWorkspace(workspaceId)
    hydrated.current = false
    const rest = (await api.listWorkspaces()).workspaces
    if (rest.length === 0) {
      const created = await api.createWorkspace('無題の作品')
      setWorkspaces([{ ...created, story_count: 0 }])
      applyWorkspace(created, cardById)
    } else {
      setWorkspaces(rest)
      const workspace = await api.getWorkspace(rest[0].id)
      applyWorkspace(workspace, cardById)
    }
  }

  const placedIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  const palette = allCards.filter((card) => !placedIds.has(card.id))
  const chain = useMemo(() => computeChain(nodes, edges), [nodes, edges])

  const addCardNode = (card: Card) => {
    const position = { x: 80 + (nodes.length % 4) * 230, y: 120 + Math.floor(nodes.length / 4) * 190 }
    setNodes((prev) => [...prev, { id: card.id, type: 'anchor', position, data: { card } }])
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

  // 生成へ: 保存を確定してから Generate タブで自動開始
  const handleGenerate = async () => {
    if (!chain.orderedIds || !workspaceId) return
    try {
      await api.updateWorkspace(workspaceId, buildUpdatePayload())
    } catch {
      // 保存失敗でも生成は続行できる（次の自動保存でリトライされる）
    }
    setComposition({ ...composition, anchorCardIds: chain.orderedIds })
    setPendingGenerate(true)
    setPhase('generate')
  }

  const inputClass =
    'w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  return (
    <div className="relative flex h-full">
      {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} />}

      {/* 左: ワークスペース + パレット */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
        <div className="space-y-2 border-b border-[var(--border)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-dim)]">作品（ワークスペース）</span>
            <span
              className={`text-[11px] ${saveState === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-faint)]'}`}
            >
              {saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失敗' : '保存済み'}
            </span>
          </div>
          <select
            value={workspaceId ?? ''}
            onChange={(event) => void switchWorkspace(event.target.value)}
            className={inputClass}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
                {workspace.story_count > 0 ? `（${workspace.story_count} 話）` : ''}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {[
              { label: '＋ 新規', onClick: handleCreate },
              { label: '名前', onClick: handleRename },
              { label: '複製', onClick: handleDuplicate },
              { label: '削除', onClick: handleDelete }
            ].map(({ label, onClick }) => (
              <button
                key={label}
                onClick={() => void onClick()}
                className="flex-1 rounded border border-[var(--border-strong)] px-1 py-1 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-[var(--border)] px-3 py-2 text-[13px] font-semibold text-[var(--text-dim)]">
          カード（クリックで配置）
        </div>
        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {palette.length === 0 && (
            <div className="px-1 py-2 text-[12px] text-[var(--text-faint)]">
              {allCards.length === 0 ? 'Vault でカードを登録してください。' : 'すべて配置済みです。'}
            </div>
          )}
          {palette.map((card) => (
            <button
              key={card.id}
              onClick={() => addCardNode(card)}
              className="flex w-full items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-left hover:border-[var(--border-strong)]"
            >
              <span className="min-w-0 flex-1 truncate text-[12px]">{card.title}</span>
              <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
                {ROLE_LABELS[card.role]}
              </span>
            </button>
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
          onConnect={onConnect}
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.2}
          maxZoom={1.5}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-[var(--bg-canvas)]"
        >
          <Background gap={20} />
          <MiniMap pannable zoomable className="!bg-[var(--bg-sidebar)]" />
        </ReactFlow>

        {/* ステータス */}
        <div className="absolute left-3 top-3 rounded-md border border-[var(--border)] bg-[var(--bg-sidebar)]/95 px-3 py-2 text-[12px] text-[var(--text-dim)]">
          {chain.orderedIds ? `${chain.orderedIds.length} シーン（左から順に清書）` : chain.reason}
        </div>
      </div>

      {/* 生成設定 */}
      <aside className="flex w-[280px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)]">
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
