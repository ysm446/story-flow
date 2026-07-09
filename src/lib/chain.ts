import type { Edge, Node } from '@xyflow/react'
import type { CompositionAnchor } from '../store/appStore'

/** エッジ列から一本鎖の並び順を求める。成立しなければ理由を返す */
export function computeChain(nodes: Node[], edges: Edge[]): { orderedIds: string[] | null; reason: string | null } {
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

/**
 * Compose グラフからアンカー列（カード ID + 追加指示 + BGM 指名）を導出する。
 * 一本鎖が成立していなければ null。
 * Generate はスナップショットではなく常にこれで「いまのグラフ」から組み立てる
 * （古いスナップショットで生成すると、Compose での編集が黙って無視される）。
 */
export function chainAnchors(nodes: Node[], edges: Edge[]): CompositionAnchor[] | null {
  const { orderedIds } = computeChain(nodes, edges)
  if (!orderedIds) return null
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return orderedIds.map((cardId) => {
    const data = (nodeById.get(cardId)?.data ?? {}) as { instruction?: string; bgmId?: string | null }
    const instruction = (data.instruction ?? '').trim()
    return { cardId, instruction: instruction || null, bgmId: data.bgmId ?? null }
  })
}
