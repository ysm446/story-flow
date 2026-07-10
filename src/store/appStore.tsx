import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { CardRole, CardTone, LoreMemo, SceneLength } from '../lib/api'

export type PhaseId = 'vault' | 'compose' | 'generate' | 'theater'

/**
 * フェーズ間で共有する状態。
 * Compose のグラフ（composeNodes/composeEdges）と生成設定（composition）を Generate が読む、が中核。
 * アンカー列はスナップショットとして持たず、Generate が生成時に src/lib/chain.ts で
 * グラフから導出する（古いスナップショットによる生成事故を防ぐ）。
 */
export interface CompositionAnchor {
  kind: 'card' | 'gap'
  nodeId: string // Compose グラフ上のノード ID（card はカード ID、gap は gap-xxx）
  cardId: string | null // gap のときは null（生成時に fill_gap が選ぶ）
  targetRole: CardRole | null // gap の希望ロール
  instruction: string | null
  bgmId: string | null
}

export interface CompositionDraft {
  plot: string
  targetTone: CardTone | ''
  promptPresetId: string | null
  sceneLength: SceneLength | ''
  /** この作品で使うフォルダ（ルートは常時使用。選択はサブツリーを含む。空 = ルートのみ） */
  folderIds: string[]
  /** 背景設定メモ（作品の恒久設定 = canon）。清書時に全文注入される */
  lore: LoreMemo[]
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
    plot: '',
    targetTone: '',
    promptPresetId: null,
    sceneLength: '',
    folderIds: [],
    lore: []
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
