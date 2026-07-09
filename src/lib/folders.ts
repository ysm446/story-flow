import type { Folder } from './api'

export interface FolderTreeNode {
  folder: Folder
  depth: number
}

/** フラット配列を sort_order 順の深さ付きリストに変換（DOM はフラット、インデントで階層表現） */
export function flattenTree(folders: Folder[]): FolderTreeNode[] {
  const childrenOf = new Map<string | null, Folder[]>()
  for (const folder of folders) {
    const list = childrenOf.get(folder.parent_id) ?? []
    list.push(folder)
    childrenOf.set(folder.parent_id, list)
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  }
  const result: FolderTreeNode[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childrenOf.get(parentId) ?? []) {
      result.push({ folder, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
}

/** folderId が ancestorId の子孫（または本人）か。フォルダ移動の循環ガード用 */
export function isDescendant(folders: Folder[], folderId: string, ancestorId: string): boolean {
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parent_id]))
  let current: string | null | undefined = folderId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = parentOf.get(current)
  }
  return false
}

/** 選択フォルダをサブツリー（子孫含む）に展開する。Compose の「使うフォルダ」解決用 */
export function expandFolderSelection(folders: Folder[], selectedIds: string[]): Set<string> {
  const childrenOf = new Map<string | null, string[]>()
  for (const folder of folders) {
    const list = childrenOf.get(folder.parent_id) ?? []
    list.push(folder.id)
    childrenOf.set(folder.parent_id, list)
  }
  const result = new Set<string>()
  const stack = [...selectedIds]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (result.has(current)) continue
    result.add(current)
    stack.push(...(childrenOf.get(current) ?? []))
  }
  return result
}
