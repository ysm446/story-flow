import { useEffect, useState } from 'react'
import { api, type PromptInfo } from '../../lib/api'

/**
 * 生成用 system prompt の編集。backend/prompts/*.md が既定値、
 * 上書きは data/prompts/ に保存される。出力形式（JSON）指示はシステム側が
 * 必ず付与するため、ここで編集するのは語り方・制約の本文のみ。
 */
export function PromptEditor({ name }: { name: 'writer' | 'selector' }) {
  const [info, setInfo] = useState<PromptInfo | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    void api.getPrompt(name).then((loaded) => {
      if (canceled) return
      setInfo(loaded)
      setText(loaded.effective)
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      canceled = true
    }
  }, [name])

  const isDirty = info !== null && text !== info.effective
  const isOverridden = info?.override !== null && info?.override !== undefined

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await api.setPrompt(name, text)
      setInfo(next)
      setText(next.effective)
      setMessage('保存しました（上書きとして適用中）')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm('上書きを破棄して既定のプロンプトに戻しますか？')) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.setPrompt(name, null)
      setInfo(next)
      setText(next.effective)
      setMessage('既定に戻しました')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!info) {
    return <div className="text-[12px] text-[var(--text-faint)]">{error ?? '読み込み中…'}</div>
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[12px] text-[var(--text-dim)]">
        <span>system prompt（{name}）</span>
        {isOverridden && (
          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px]">上書き適用中</span>
        )}
        {message && <span className="text-[var(--ok)]">{message}</span>}
      </div>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setMessage(null)
        }}
        rows={12}
        className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-2 font-mono text-[12px] leading-relaxed focus:outline focus:outline-1 focus:outline-[var(--accent-border)]"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={busy || !isDirty}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-[12px] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          保存
        </button>
        <button
          onClick={() => void handleReset()}
          disabled={busy || !isOverridden}
          className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
        >
          既定に戻す
        </button>
        <span className="text-[11px] text-[var(--text-faint)]">
          出力形式（JSON）の指示は自動で付与されるため、ここには書かなくてよい
        </span>
      </div>
      {error && <div className="text-[12px] text-[var(--danger)]">{error}</div>}
    </div>
  )
}
