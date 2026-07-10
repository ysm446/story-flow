import { useCallback, useEffect, useState } from 'react'
import { api, type PromptConfig, type PromptKind, type PromptPreset } from '../lib/api'
import { reportStatusAction } from '../lib/statusActions'

/**
 * 生成用 system prompt のプリセット管理（設定画面用）。
 * 物語の種類に合わせて複数のプロンプトを作り、切り替えて使う。
 * 「既定」は読み取り専用で、常にフォールバックとして残る。
 */
export function PromptManager({ kind, title }: { kind: PromptKind; title: string }) {
  const [config, setConfig] = useState<PromptConfig | null>(null)
  const [editingId, setEditingId] = useState<string | 'default' | null>(null)
  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setConfig(await api.getPromptConfig(kind))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [kind])

  useEffect(() => {
    void load()
  }, [load])

  const startEdit = (preset: PromptPreset | 'default') => {
    if (preset === 'default') {
      setEditingId('default')
      setEditName('既定')
      setEditContent(config?.default ?? '')
    } else {
      setEditingId(preset.id)
      setEditName(preset.name)
      setEditContent(preset.content)
    }
    setError(null)
  }

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = () =>
    run(async () => {
      const preset = await api.createPromptPreset(kind, '新しいプロンプト')
      startEdit(preset)
    })

  const handleSaveEdit = () => {
    if (editingId === null || editingId === 'default') return
    return run(async () => {
      await api.updatePromptPreset(kind, editingId, { name: editName, content: editContent })
      reportStatusAction(`プロンプト「${editName}」を保存しました`)
      setEditingId(null)
    })
  }

  const handleDelete = (preset: PromptPreset) => {
    if (!window.confirm(`プリセット「${preset.name}」を削除しますか？`)) return
    return run(async () => {
      await api.deletePromptPreset(kind, preset.id)
      if (editingId === preset.id) setEditingId(null)
    })
  }

  if (!config) {
    return <div className="text-[12px] text-[var(--text-faint)]">{error ?? '読み込み中…'}</div>
  }

  const rowClass = (isActive: boolean) =>
    `flex items-center gap-2 rounded-md border px-2.5 py-2 ${
      isActive ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--bg-card)]'
    }`

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--text-dim)]">{title}</h3>
        <button
          onClick={() => void handleCreate()}
          disabled={busy}
          className="rounded border border-[var(--border-strong)] px-2 py-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
        >
          ＋ 追加
        </button>
      </div>

      <ul className="space-y-1.5">
        {/* 既定（読み取り専用） */}
        <li className={rowClass(config.active_id === null)}>
          <input
            type="radio"
            name={`prompt-active-${kind}`}
            checked={config.active_id === null}
            onChange={() => void run(() => api.setActivePrompt(kind, null))}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
            aria-label="既定を使う"
          />
          <span className="min-w-0 flex-1 truncate text-[13px]">既定</span>
          <button
            onClick={() => startEdit('default')}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-faint)] hover:bg-[var(--bg-elevated)]"
            title="内容を確認（編集する場合は複製してください）"
          >
            表示
          </button>
        </li>

        {config.presets.map((preset) => (
          <li key={preset.id} className={rowClass(config.active_id === preset.id)}>
            <input
              type="radio"
              name={`prompt-active-${kind}`}
              checked={config.active_id === preset.id}
              onChange={() => void run(() => api.setActivePrompt(kind, preset.id))}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
              aria-label={`${preset.name} を使う`}
            />
            <span className="min-w-0 flex-1 truncate text-[13px]">{preset.name}</span>
            <button
              onClick={() => startEdit(preset)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
            >
              編集
            </button>
            <button
              onClick={() => void handleDelete(preset)}
              disabled={busy}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.08)] disabled:opacity-50"
            >
              削除
            </button>
          </li>
        ))}
      </ul>

      {/* エディタ */}
      {editingId !== null && (
        <div className="mt-3 space-y-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] p-2.5">
          {editingId === 'default' ? (
            <div className="text-[12px] text-[var(--text-faint)]">
              既定プロンプト（読み取り専用）。ベースに使う場合は「複製して編集」。
            </div>
          ) : (
            <input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              maxLength={60}
              placeholder="プリセット名（例: ホラー短編用）"
              className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px]"
            />
          )}
          <textarea
            value={editContent}
            onChange={(event) => setEditContent(event.target.value)}
            readOnly={editingId === 'default'}
            rows={12}
            className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-2 font-mono text-[12px] leading-relaxed read-only:opacity-70"
          />
          <div className="flex items-center gap-2">
            {editingId === 'default' ? (
              <button
                onClick={() =>
                  void run(async () => {
                    const preset = await api.createPromptPreset(kind, '既定のコピー', editContent)
                    startEdit(preset)
                  })
                }
                disabled={busy}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-[12px] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                複製して編集
              </button>
            ) : (
              <button
                onClick={() => void handleSaveEdit()}
                disabled={busy}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-[12px] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                保存
              </button>
            )}
            <button
              onClick={() => setEditingId(null)}
              className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)]"
            >
              閉じる
            </button>
            <span className="text-[11px] text-[var(--text-faint)]">出力形式（JSON）指示は自動付与</span>
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-[var(--danger)]">{error}</div>}
    </section>
  )
}
