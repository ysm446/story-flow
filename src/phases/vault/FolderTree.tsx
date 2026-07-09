import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDown, IconFolder, IconMore, IconPlus } from '../../components/icons'
import { api, type Folder } from '../../lib/api'
import { flattenTree, isDescendant, type FolderTreeNode } from '../../lib/folders'

/** Vault のフォルダ絞り込み: すべて / ルート（共有） / フォルダ ID */
export type FolderFilter = 'all' | 'root' | string

/** カードのドラッグに使う MIME（グリッド側の dragstart と揃える） */
export const CARD_DRAG_MIME = 'application/x-story-flow-card'
const FOLDER_DRAG_MIME = 'application/x-story-flow-folder'

const EXPANDED_KEY = 'story-flow:vault-expanded-folders'

type DropPos = 'before' | 'after' | 'inside'
type EditState = { mode: 'create'; parentId: string | null } | { mode: 'rename'; id: string } | null
type TreeNode = FolderTreeNode

/**
 * フォルダツリー（image-assistant のライブラリを参考）。
 * - ルート（共有）= folder_id IS NULL。全作品で常に使える共通素材
 * - カードをフォルダ行へドロップで所属変更、フォルダ同士は Y 座標 3 分割で
 *   並べ替え（上下 30%）/ 入れ子化（中央）
 */
export function FolderTree({
  folders,
  rootCount,
  totalCount,
  selected,
  onSelect,
  onChanged,
  onCardDrop
}: {
  folders: Folder[]
  rootCount: number
  totalCount: number
  selected: FolderFilter
  onSelect: (filter: FolderFilter) => void
  onChanged: () => void
  onCardDrop: (cardId: string, folderId: string | null) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const [edit, setEdit] = useState<EditState>(null)
  const [editValue, setEditValue] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: DropPos } | 'root' | null>(null)
  const draggedFolder = useRef<string | null>(null)

  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
  }, [expanded])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const nodes = useMemo(() => flattenTree(folders), [folders])
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const hasChildren = useMemo(() => new Set(folders.map((folder) => folder.parent_id).filter(Boolean) as string[]), [folders])

  // 折りたたまれた祖先を持つノードは描画しない
  const visibleNodes = nodes.filter((node) => {
    let parent = node.folder.parent_id
    while (parent) {
      if (!expanded.has(parent)) return false
      parent = folderById.get(parent)?.parent_id ?? null
    }
    return true
  })

  const startCreate = (parentId: string | null) => {
    setMenu(null)
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId))
    setEditValue('')
    setEdit({ mode: 'create', parentId })
  }

  const startRename = (folder: Folder) => {
    setMenu(null)
    setEditValue(folder.name)
    setEdit({ mode: 'rename', id: folder.id })
  }

  const commitEdit = async () => {
    const state = edit
    const name = editValue.trim()
    setEdit(null)
    if (!state || !name) return
    try {
      if (state.mode === 'create') {
        await api.createFolder(name, state.parentId)
      } else {
        await api.renameFolder(state.id, name)
      }
      onChanged()
    } catch (cause) {
      console.error('[vault] folder edit failed:', cause)
    }
  }

  const handleDelete = async (folder: Folder) => {
    setMenu(null)
    if (!window.confirm(`フォルダ「${folder.name}」を削除しますか？\n中のカードとサブフォルダは 1 つ上の階層へ移動します（カードは消えません）。`)) {
      return
    }
    try {
      await api.deleteFolder(folder.id)
      if (selected === folder.id) onSelect('all')
      onChanged()
    } catch (cause) {
      console.error('[vault] folder delete failed:', cause)
    }
  }

  // --- DnD ---

  const isCardDrag = (event: React.DragEvent) => event.dataTransfer.types.includes(CARD_DRAG_MIME)
  const isFolderDrag = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(FOLDER_DRAG_MIME) || draggedFolder.current !== null

  const handleItemDragOver = (event: React.DragEvent, node: TreeNode) => {
    if (edit) return
    if (isCardDrag(event)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget({ id: node.folder.id, pos: 'inside' })
      return
    }
    const dragged = draggedFolder.current
    if (!dragged || !isFolderDrag(event) || dragged === node.folder.id) return
    if (isDescendant(folders, node.folder.id, dragged)) return // 自分の子孫へは落とせない
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const relY = (event.clientY - rect.top) / rect.height
    const sameParent = folderById.get(dragged)?.parent_id === node.folder.parent_id
    const pos: DropPos = sameParent && relY < 0.3 ? 'before' : sameParent && relY > 0.7 ? 'after' : 'inside'
    setDropTarget({ id: node.folder.id, pos })
  }

  const handleItemDrop = async (event: React.DragEvent, node: TreeNode) => {
    event.preventDefault()
    const indicator = dropTarget
    setDropTarget(null)
    const cardId = event.dataTransfer.getData(CARD_DRAG_MIME)
    if (cardId) {
      onCardDrop(cardId, node.folder.id)
      return
    }
    const dragged = event.dataTransfer.getData(FOLDER_DRAG_MIME) || draggedFolder.current
    draggedFolder.current = null
    if (!dragged || dragged === node.folder.id) return
    try {
      const pos = indicator && indicator !== 'root' && indicator.id === node.folder.id ? indicator.pos : 'inside'
      if (pos === 'inside') {
        await api.moveFolder(dragged, node.folder.id)
        setExpanded((prev) => new Set(prev).add(node.folder.id))
      } else {
        // 同一階層の兄弟を並べ替え（dragged を抜いて target の前/後に挿入）
        const siblings = nodes
          .filter((item) => item.folder.parent_id === node.folder.parent_id)
          .map((item) => item.folder.id)
          .filter((id) => id !== dragged)
        const targetIndex = siblings.indexOf(node.folder.id)
        siblings.splice(pos === 'before' ? targetIndex : targetIndex + 1, 0, dragged)
        await api.reorderFolders(siblings)
      }
      onChanged()
    } catch (cause) {
      console.error('[vault] folder move failed:', cause)
    }
  }

  const handleRootDragOver = (event: React.DragEvent) => {
    if (isCardDrag(event) || (isFolderDrag(event) && draggedFolder.current)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget('root')
    }
  }

  const handleRootDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    const cardId = event.dataTransfer.getData(CARD_DRAG_MIME)
    if (cardId) {
      onCardDrop(cardId, null)
      return
    }
    const dragged = event.dataTransfer.getData(FOLDER_DRAG_MIME) || draggedFolder.current
    draggedFolder.current = null
    if (!dragged) return
    try {
      await api.moveFolder(dragged, null) // トップレベル化
      onChanged()
    } catch (cause) {
      console.error('[vault] folder move failed:', cause)
    }
  }

  const itemBase = 'group flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[12px]'
  const itemColor = (active: boolean) =>
    active
      ? 'bg-[var(--accent-soft)] text-[var(--text)] outline outline-1 outline-[var(--accent-border)]'
      : 'text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'

  const editInput = (
    <input
      autoFocus
      value={editValue}
      onChange={(event) => setEditValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void commitEdit()
        if (event.key === 'Escape') setEdit(null)
      }}
      onBlur={() => void commitEdit()}
      maxLength={60}
      placeholder="フォルダ名"
      className="w-full rounded border border-[var(--accent-border)] bg-[var(--bg-input)] px-1.5 py-1 text-[12px] focus:outline-none"
    />
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2 pt-2">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
          フォルダ
        </span>
        <button
          onClick={() => startCreate(null)}
          aria-label="新しいフォルダ"
          title="新しいフォルダ"
          className="flex items-center rounded border border-[var(--border-strong)] p-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
        >
          <IconPlus size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {/* すべて */}
        <button onClick={() => onSelect('all')} className={`${itemBase} ${itemColor(selected === 'all')}`}>
          <span className="w-3.5" />
          <span className="min-w-0 flex-1 truncate">すべて</span>
          <span className="text-[10px] text-[var(--text-faint)]">{totalCount}</span>
        </button>

        {/* ルート（共有）: カード/フォルダのドロップでトップレベル化 */}
        <button
          onClick={() => onSelect('root')}
          onDragOver={handleRootDragOver}
          onDragLeave={() => setDropTarget((prev) => (prev === 'root' ? null : prev))}
          onDrop={(event) => void handleRootDrop(event)}
          title="どの作品でも常に使える共通素材。フォルダやカードをここへドロップすると一番上の階層に移動します"
          className={`${itemBase} ${itemColor(selected === 'root')} ${
            dropTarget === 'root' ? 'outline-dashed outline-1 outline-[var(--accent)]' : ''
          }`}
        >
          <span className="flex w-3.5 justify-center text-[var(--text-faint)]">
            <IconFolder size={13} />
          </span>
          <span className="min-w-0 flex-1 truncate">ルート（共有）</span>
          <span className="text-[10px] text-[var(--text-faint)]">{rootCount}</span>
        </button>

        {/* トップレベルへの新規作成 */}
        {edit?.mode === 'create' && edit.parentId === null && <div className="px-1 py-0.5">{editInput}</div>}

        {visibleNodes.map((node) => {
          const { folder, depth } = node
          const isExpanded = expanded.has(folder.id)
          const isLeaf = !hasChildren.has(folder.id)
          const indicator = dropTarget !== 'root' && dropTarget?.id === folder.id ? dropTarget.pos : null
          return (
            <div key={folder.id}>
              <div
                role="button"
                tabIndex={0}
                draggable={!edit}
                onClick={() => onSelect(folder.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSelect(folder.id)
                }}
                onDoubleClick={() => startRename(folder)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(FOLDER_DRAG_MIME, folder.id)
                  event.dataTransfer.setData('text/plain', folder.id)
                  event.dataTransfer.effectAllowed = 'move'
                  draggedFolder.current = folder.id
                }}
                onDragEnd={() => {
                  draggedFolder.current = null
                  setDropTarget(null)
                }}
                onDragOver={(event) => handleItemDragOver(event, node)}
                onDragLeave={() =>
                  setDropTarget((prev) => (prev !== 'root' && prev?.id === folder.id ? null : prev))
                }
                onDrop={(event) => void handleItemDrop(event, node)}
                style={{ paddingLeft: 8 + depth * 14 }}
                className={`${itemBase} cursor-pointer ${itemColor(selected === folder.id)} ${
                  indicator === 'inside' ? 'outline-dashed outline-1 outline-[var(--accent)]' : ''
                } ${indicator === 'before' ? 'shadow-[inset_0_2px_0_var(--accent)]' : ''} ${
                  indicator === 'after' ? 'shadow-[inset_0_-2px_0_var(--accent)]' : ''
                }`}
              >
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpanded((prev) => {
                      const next = new Set(prev)
                      if (next.has(folder.id)) next.delete(folder.id)
                      else next.add(folder.id)
                      return next
                    })
                  }}
                  aria-label={isExpanded ? '折りたたむ' : '展開する'}
                  className={`flex w-3.5 shrink-0 justify-center text-[var(--text-faint)] ${
                    isLeaf ? 'invisible' : ''
                  }`}
                >
                  <span className={isExpanded ? '' : '-rotate-90'}>
                    <IconChevronDown size={11} />
                  </span>
                </button>
                {edit?.mode === 'rename' && edit.id === folder.id ? (
                  <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
                    {editInput}
                  </span>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    {folder.card_count > 0 && (
                      <span className="text-[10px] text-[var(--text-faint)]">{folder.card_count}</span>
                    )}
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMenu({ id: folder.id, x: rect.right, y: rect.bottom + 4 })
                      }}
                      aria-label="メニュー"
                      className={`flex shrink-0 items-center rounded p-0.5 text-[var(--text-faint)] hover:bg-[var(--bg-card)] hover:text-[var(--text)] ${
                        menu?.id === folder.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <IconMore size={13} />
                    </button>
                  </>
                )}
              </div>
              {/* 子フォルダの新規作成（親の直後に挿入） */}
              {edit?.mode === 'create' && edit.parentId === folder.id && (
                <div className="py-0.5" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                  {editInput}
                </div>
              )}
            </div>
          )
        })}

        {folders.length === 0 && edit === null && (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
            フォルダはまだありません。＋ で作成し、カードをドラッグして整理できます。
          </p>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-[150px] -translate-x-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-sidebar)] py-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => startCreate(menu.id)}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
          >
            子フォルダを作成
          </button>
          <button
            onClick={() => {
              const folder = folderById.get(menu.id)
              if (folder) startRename(folder)
            }}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
          >
            名前を変更
          </button>
          <button
            onClick={() => {
              const folder = folderById.get(menu.id)
              if (folder) void handleDelete(folder)
            }}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-elevated)]"
          >
            削除
          </button>
        </div>
      )}
    </div>
  )
}
