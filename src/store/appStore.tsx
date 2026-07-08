import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { CardTone, SceneLength } from '../lib/api'

export type PhaseId = 'vault' | 'compose' | 'generate' | 'theater'

/**
 * フェーズ間で共有する状態。
 * Compose で組んだアンカー列（composition ドラフト）を Generate が読む、が中核。
 * v1 ではアンカー（カード ID の並び）のみ。GAP スロットは v1.5 で追加する。
 */
export interface CompositionDraft {
  anchorCardIds: string[]
  plot: string
  targetTone: CardTone | ''
  promptPresetId: string | null
  sceneLength: SceneLength | ''
}

interface AppStore {
  phase: PhaseId
  setPhase: (phase: PhaseId) => void
  /** 現在編集中のワークスペース。Compose が読み書きし、Generate が生成時に紐付ける */
  workspaceId: string | null
  setWorkspaceId: (workspaceId: string | null) => void
  composition: CompositionDraft
  setComposition: (draft: CompositionDraft) => void
  /** Compose キャンバスの状態（タブ切替で消えないようにここで保持。永続化は今後の課題） */
  composeNodes: Node[]
  composeEdges: Edge[]
  setComposeGraph: (nodes: Node[], edges: Edge[]) => void
  /** Compose の「生成する」からの遷移フラグ。Generate 側がマウント時に消費して自動開始する */
  pendingGenerate: boolean
  setPendingGenerate: (pending: boolean) => void
}

const AppStoreContext = createContext<AppStore | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<PhaseId>('vault')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [composition, setComposition] = useState<CompositionDraft>({
    anchorCardIds: [],
    plot: '',
    targetTone: '',
    promptPresetId: null,
    sceneLength: ''
  })
  const [composeNodes, setComposeNodes] = useState<Node[]>([])
  const [composeEdges, setComposeEdges] = useState<Edge[]>([])
  const [pendingGenerate, setPendingGenerate] = useState(false)

  const value = useMemo(
    () => ({
      phase,
      setPhase,
      workspaceId,
      setWorkspaceId,
      composition,
      setComposition,
      composeNodes,
      composeEdges,
      setComposeGraph: (nodes: Node[], edges: Edge[]) => {
        setComposeNodes(nodes)
        setComposeEdges(edges)
      },
      pendingGenerate,
      setPendingGenerate
    }),
    [phase, workspaceId, composition, composeNodes, composeEdges, pendingGenerate]
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext)
  if (!store) throw new Error('useAppStore must be used within AppStoreProvider.')
  return store
}
