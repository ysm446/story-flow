import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type PhaseId = 'vault' | 'compose' | 'generate' | 'theater'

/**
 * フェーズ間で共有する状態。
 * Compose で組んだアンカー列（composition ドラフト）を Generate が読む、が中核。
 * v1 ではアンカー（カード ID の並び）のみ。GAP スロットは v1.5 で追加する。
 */
export interface CompositionDraft {
  anchorCardIds: string[]
  plot: string
}

interface AppStore {
  phase: PhaseId
  setPhase: (phase: PhaseId) => void
  composition: CompositionDraft
  setComposition: (draft: CompositionDraft) => void
}

const AppStoreContext = createContext<AppStore | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<PhaseId>('vault')
  const [composition, setComposition] = useState<CompositionDraft>({ anchorCardIds: [], plot: '' })

  const value = useMemo(
    () => ({ phase, setPhase, composition, setComposition }),
    [phase, composition]
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext)
  if (!store) throw new Error('useAppStore must be used within AppStoreProvider.')
  return store
}
