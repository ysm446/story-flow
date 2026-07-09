import type { Edge, Node } from '@xyflow/react'
import type { CompositionAnchor } from '../store/appStore'

function nodeKind(node: Node | undefined): 'card' | 'gap' {
  return (node?.data as { kind?: 'card' | 'gap' } | undefined)?.kind === 'gap' ? 'gap' : 'card'
}

/** エッジ列から一本鎖の並び順を求める。成立しなければ理由を返す */
export function computeChain(nodes: Node[], edges: Edge[]): { orderedIds: string[] | null; reason: string | null } {
  if (nodes.length === 0) return { orderedIds: null, reason: 'カードを置いてください' }
  if (nodes.length === 1) {
    if (nodeKind(nodes[0]) === 'gap') {
      return { orderedIds: null, reason: '始点と終点にはカードを置いてください' }
    }
    return { orderedIds: [nodes[0].id], reason: null }
  }

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
  // 始点・終点は必ずカード（穴は「固定点の間」を埋めるもの。spec §1.5）
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  if (nodeKind(nodeById.get(ordered[0])) === 'gap' || nodeKind(nodeById.get(ordered[ordered.length - 1])) === 'gap') {
    return { orderedIds: null, reason: '始点と終点にはカードを置いてください（おまかせは中間のみ）' }
  }
  return { orderedIds: ordered, reason: null }
}

/**
 * Compose グラフからスロット列（カード or おまかせ + 追加指示 + BGM 指名）を導出する。
 * 一本鎖が成立していなければ null。
 * Generate はスナップショットではなく常にこれで「いまのグラフ」から組み立てる
 * （古いスナップショットで生成すると、Compose での編集が黙って無視される）。
 */
export function chainAnchors(nodes: Node[], edges: Edge[]): CompositionAnchor[] | null {
  const { orderedIds } = computeChain(nodes, edges)
  if (!orderedIds) return null
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return orderedIds.map((nodeId) => {
    const node = nodeById.get(nodeId)
    const data = (node?.data ?? {}) as {
      kind?: 'card' | 'gap'
      instruction?: string
      bgmId?: string | null
      targetRole?: string | null
    }
    const kind = data.kind === 'gap' ? ('gap' as const) : ('card' as const)
    const instruction = (data.instruction ?? '').trim()
    return {
      kind,
      nodeId,
      cardId: kind === 'gap' ? null : nodeId,
      targetRole: (kind === 'gap' ? (data.targetRole as CompositionAnchor['targetRole']) : null) ?? null,
      instruction: instruction || null,
      bgmId: data.bgmId ?? null
    }
  })
}
