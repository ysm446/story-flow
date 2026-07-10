import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconAlert, IconMusic } from '../../components/icons'
import { api, bgmFileUrl, type Bgm } from '../../lib/api'
import { reportStatusAction } from '../../lib/statusActions'

type SearchMode = 'keyword' | 'semantic'

/**
 * Vault の BGM ライブラリ。mp3 等を登録し、曲の雰囲気を説明文で書く。
 * 説明文は埋め込まれ、のちにムードでベクトル検索して選曲する土台になる。
 */
export function BgmLibrary() {
  const [items, setItems] = useState<Bgm[]>([])
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')
  const [editing, setEditing] = useState<Bgm | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const trimmed = query.trim()
      const result = await api.listBgm({
        q: searchMode === 'keyword' && trimmed ? trimmed : undefined,
        semantic: searchMode === 'semantic' && trimmed ? trimmed : undefined
      })
      setItems(result.bgm)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [query, searchMode])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaved = (saved: Bgm) => {
    setEditing(saved)
    void load()
  }

  const handleDeleted = () => {
    setEditing(null)
    void load()
  }

  const inputClass =
    'rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void load()
              }}
            >
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchMode === 'keyword' ? 'キーワード検索（FTS）' : '意味検索（雰囲気で）'}
                className={`${inputClass} w-64`}
              />
              <select
                value={searchMode}
                onChange={(event) => setSearchMode(event.target.value as SearchMode)}
                className={inputClass}
                title="検索モード"
              >
                <option value="keyword">キーワード</option>
                <option value="semantic">意味</option>
              </select>
              <button
                type="submit"
                className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[13px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
              >
                検索
              </button>
            </form>

            <button
              onClick={() => setEditing('new')}
              className="ml-auto rounded bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              ＋ BGM を追加
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[13px] text-[var(--danger)]">
              {error}
            </div>
          )}

          {items.length === 0 && !error ? (
            <div className="mt-16 text-center text-[13px] text-[var(--text-faint)]">
              BGM がありません。「＋ BGM を追加」から mp3 を登録してください。
            </div>
          ) : (
            <ul className="mt-5 space-y-2">
              {items.map((bgm) => (
                <li
                  key={bgm.id}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${
                    editing !== 'new' && editing?.id === bgm.id
                      ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <button onClick={() => setEditing(bgm)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[var(--bg-canvas)] text-[var(--text-dim)]">
                      <IconMusic size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{bgm.title}</span>
                        {bgm.description.trim() && !bgm.has_embedding && (
                          <span className="shrink-0 text-[var(--danger)]" title="埋め込み未計算">
                            <IconAlert size={11} />
                          </span>
                        )}
                        {!bgm.media_path && (
                          <span className="shrink-0 text-[10px] text-[var(--text-faint)]">（音源なし）</span>
                        )}
                      </span>
                      <span className="mt-0.5 line-clamp-1 block text-[11px] text-[var(--text-faint)]">
                        {bgm.description || '（説明なし）'}
                      </span>
                    </span>
                  </button>
                  {bgm.media_path && (
                    <audio src={bgmFileUrl(bgm.id)} controls preload="none" className="h-8 w-56 shrink-0" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing !== null && (
        <BgmEditor
          key={editing === 'new' ? 'new' : editing.id}
          bgm={editing === 'new' ? null : editing}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function BgmEditor({
  bgm,
  onSaved,
  onDeleted,
  onClose
}: {
  bgm: Bgm | null
  onSaved: (bgm: Bgm) => void
  onDeleted: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(bgm?.title ?? '')
  const [description, setDescription] = useState(bgm?.description ?? '')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pendingUrl = useMemo(() => (pendingFile ? URL.createObjectURL(pendingFile) : null), [pendingFile])
  const prevUrl = useRef<string | null>(null)
  useEffect(() => {
    if (prevUrl.current && prevUrl.current !== pendingUrl) URL.revokeObjectURL(prevUrl.current)
    prevUrl.current = pendingUrl
  }, [pendingUrl])

  const previewUrl = pendingUrl ?? (bgm?.media_path ? bgmFileUrl(bgm.id) : null)

  const handleSave = async () => {
    if (!title.trim()) {
      setError('タイトルは必須です。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const input = { title: title.trim(), description: description.trim() }
      let saved = bgm ? await api.updateBgm(bgm.id, input) : await api.createBgm(input)
      if (pendingFile) {
        saved = await api.uploadBgmMedia(saved.id, pendingFile)
        setPendingFile(null)
      }
      reportStatusAction(`BGM「${saved.title}」を${bgm ? '更新' : '作成'}しました`)
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!bgm) return
    if (!window.confirm(`BGM「${bgm.title}」を削除しますか？`)) return
    setSaving(true)
    try {
      await api.deleteBgm(bgm.id)
      onDeleted()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[15px] font-semibold">{bgm ? 'BGM を編集' : 'BGM を追加'}</h2>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="rounded px-2 py-1 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* 音源 */}
        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-3 text-[13px] text-[var(--text-dim)] hover:border-[var(--accent-border)] hover:text-[var(--text)]"
          >
            <IconMusic size={16} />
            {pendingFile ? pendingFile.name : previewUrl ? '音源を差し替える' : 'mp3 を選択'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac,.aac"
            className="hidden"
            onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
          />
          {previewUrl && <audio src={previewUrl} controls preload="none" className="mt-2 w-full" />}
          {pendingFile && (
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">保存時にアップロード: {pendingFile.name}</div>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-[12px] text-[var(--text-dim)]">タイトル</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} maxLength={100} />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
            雰囲気の説明（この曲が合う場面・情感。意味検索の手がかりになる）
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={500}
            placeholder="例: 静かな夜明け。ピアノ主体で、切なくも希望のある終盤に。"
            className={`${inputClass} leading-relaxed`}
          />
          <span className="mt-0.5 block text-right text-[11px] text-[var(--text-faint)]">{description.length}/500</span>
        </label>

        {error && (
          <div className="rounded-md border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[13px] text-[var(--danger)]">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-3">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {bgm && (
          <button
            onClick={() => void handleDelete()}
            disabled={saving}
            className="ml-auto rounded border border-[var(--danger)] px-3 py-2 text-[13px] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.08)] disabled:opacity-50"
          >
            削除
          </button>
        )}
      </div>
    </aside>
  )
}
