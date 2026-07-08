import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { api, cardFileUrl, type Card, type CardRole } from '../../lib/api'
import { useAppStore } from '../../store/appStore'

const ROLE_LABELS: Record<CardRole, string> = {
  intro: '導入',
  rising: '展開',
  turn: '転換',
  climax: 'クライマックス',
  ending: '結末'
}

/**
 * Compose: 始点・中間・終点アンカーをノードで置き、線で繋いで並び順を決める。
 * v1 のエッジは「並び順 = 次に来る」のみ（分岐は v2）。一本鎖になるよう接続を制約する。
 * ノード id = カード id（同じカードは 1 度だけ置ける）。
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
      {card.media_path && card.media_type === 'image' && (
        <div className="h-[84px] overflow-hidden bg-[var(--bg-canvas)]">
          <img src={cardFileUrl(card.id, true)} alt="" className="h-full w-full object-cover" draggable={false} />
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

function ComposeInner() {
  const { composition, setComposition, setPhase, composeNodes, composeEdges, setComposeGraph } = useAppStore()
  const [allCards, setAllCards] = useState<Card[]>([])
  const [nodes, setNodes, onNodesChange] = useNodesState(composeNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(composeEdges)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    void api.listCards().then((result) => setAllCards(result.cards)).catch(() => setAllCards([]))
  }, [])

  // タブ切替で消えないよう store へ同期
  useEffect(() => {
    setComposeGraph(nodes, edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const placedIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  const palette = allCards.filter((card) => !placedIds.has(card.id))
  const chain = useMemo(() => computeChain(nodes, edges), [nodes, edges])

  const addCardNode = (card: Card) => {
    const position = { x: 80 + (nodes.length % 4) * 230, y: 120 + Math.floor(nodes.length / 4) * 190 }
    setNodes((prev) => [...prev, { id: card.id, type: 'anchor', position, data: { card } }])
    setSent(false)
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
      setSent(false)
    },
    [setEdges]
  )

  const handleSend = () => {
    if (!chain.orderedIds) return
    setComposition({ ...composition, anchorCardIds: chain.orderedIds })
    setSent(true)
    setPhase('generate')
  }

  return (
    <div className="flex h-full">
      {/* パレット */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
        <div className="border-b border-[var(--border)] px-3 py-2.5 text-[13px] font-semibold text-[var(--text-dim)]">
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

        {/* ツールバー */}
        <div className="absolute left-3 top-3 flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-sidebar)]/95 px-3 py-2">
          <button
            onClick={handleSend}
            disabled={!chain.orderedIds}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            この構成を Generate へ →
          </button>
          <span className="text-[12px] text-[var(--text-dim)]">
            {chain.orderedIds
              ? `${chain.orderedIds.length} シーン（左から順に清書）`
              : chain.reason}
            {sent && chain.orderedIds && ' ・ 送信済み'}
          </span>
        </div>
      </div>
    </div>
  )
}
