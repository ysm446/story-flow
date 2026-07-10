import { useEffect, useState } from 'react'
import { IconPlus, IconTrash } from '../../components/icons'
import type { LoreMemo } from '../../lib/api'

interface LoreEditorProps {
  lore: LoreMemo[]
  onChange: (lore: LoreMemo[]) => void
  onClose: () => void
}

/**
 * 背景設定（作品の恒久設定 = canon）の編集モーダル。
 * タイトル付きの複数メモとして管理し、生成時に全文が writer へ注入される。
 * 変更は即 onChange へ流す（Compose のデバウンス自動保存に乗る）。
 */
export function LoreEditor({ lore, onChange, onClose }: LoreEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(lore[0]?.id ?? null)
  const selected = lore.find((memo) => memo.id === selectedId) ?? null

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addMemo = () => {
    const memo: LoreMemo = { id: crypto.randomUUID(), title: '', body: '' }
    onChange([...lore, memo])
    setSelectedId(memo.id)
  }

  const updateMemo = (id: string, patch: Partial<LoreMemo>) => {
    onChange(lore.map((memo) => (memo.id === id ? { ...memo, ...patch } : memo)))
  }

  const deleteMemo = (id: string) => {
    const rest = lore.filter((memo) => memo.id !== id)
    onChange(rest)
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null)
  }

  const inputClass =
    'w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[440px] w-[680px] flex-col rounded-md border border-[var(--border-strong)] bg-[var(--bg-sidebar)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
          <div>
            <h3 className="text-[14px] font-semibold">背景設定</h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">
              世界観・人物・規則などこの作品の恒久設定。生成時に全メモが清書の参照資料になります
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[13px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
          >
            閉じる
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左: メモ一覧 */}
          <div className="flex w-48 shrink-0 flex-col border-r border-[var(--border)]">
            <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {lore.length === 0 && (
                <div className="px-1 py-2 text-[11px] text-[var(--text-faint)]">
                  まだメモがありません。「＋ メモを追加」から作成してください。
                </div>
              )}
              {lore.map((memo) => (
                <button
                  key={memo.id}
                  onClick={() => setSelectedId(memo.id)}
                  className={`block w-full truncate rounded px-2 py-1.5 text-left text-[13px] ${
                    memo.id === selectedId
                      ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  {memo.title.trim() || '（無題）'}
                </button>
              ))}
            </div>
            <div className="border-t border-[var(--border)] p-2">
              <button
                onClick={addMemo}
                className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-[var(--border-strong)] px-2 py-1.5 text-[12px] text-[var(--text-dim)] hover:border-[var(--accent-border)] hover:text-[var(--text)]"
              >
                <IconPlus size={12} /> メモを追加
              </button>
            </div>
          </div>

          {/* 右: 選択中メモの編集 */}
          {selected ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <input
                  value={selected.title}
                  onChange={(event) => updateMemo(selected.id, { title: event.target.value })}
                  placeholder="タイトル（例: 世界観 / 主人公 / 魔法の規則）"
                  maxLength={60}
                  className={inputClass}
                />
                <button
                  onClick={() => deleteMemo(selected.id)}
                  aria-label="このメモを削除"
                  title="このメモを削除"
                  className="shrink-0 rounded border border-[var(--border-strong)] p-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)]"
                >
                  <IconTrash size={14} />
                </button>
              </div>
              <textarea
                value={selected.body}
                onChange={(event) => updateMemo(selected.id, { body: event.target.value })}
                placeholder={'この作品で常に変わらない設定を書いてください。\n例: 舞台は雨の多い港町。主人公の澄香は 17 歳、耳の後ろに小さな傷がある。'}
                className={`${inputClass} min-h-0 flex-1 resize-none leading-relaxed`}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-faint)]">
              左の一覧からメモを選ぶか、新しく追加してください。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
