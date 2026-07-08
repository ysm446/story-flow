import { useEffect, useMemo, useRef, useState } from 'react'
import { IconFilm, IconPlay } from '../../components/icons'
import { api, cardFileUrl, type Card, type CardInput, type CardRole, type CardTag, type CardTone, type TagType } from '../../lib/api'

const ROLE_OPTIONS: Array<{ value: CardRole | ''; label: string }> = [
  { value: '', label: '自動（指定しない）' },
  { value: 'intro', label: '導入' },
  { value: 'rising', label: '展開' },
  { value: 'turn', label: '転換' },
  { value: 'climax', label: 'クライマックス' },
  { value: 'ending', label: '結末' }
]

const TONE_OPTIONS: Array<{ value: CardTone; label: string }> = [
  { value: 'happy', label: 'ハッピー' },
  { value: 'bad', label: 'バッド' },
  { value: 'bitter', label: 'ビター' },
  { value: 'neutral', label: 'ニュートラル' }
]

const TAG_FIELDS: Array<{ type: TagType; label: string; placeholder: string }> = [
  { type: 'place', label: '場所', placeholder: '例: 海辺, 廃駅' },
  { type: 'time', label: '時間', placeholder: '例: 夜, 夏の終わり' },
  { type: 'mood', label: 'ムード', placeholder: '例: 静けさ, 不穏' }
]

interface CardEditorProps {
  card: Card | null // null = 新規作成
  initialFile?: File | null // グリッドへのドロップから渡される初期メディア
  onSaved: (card: Card) => void
  onDeleted: (cardId: string) => void
  onClose: () => void
}

/** DataTransfer から最初の画像/動画ファイルを取り出す */
export function pickMediaFile(dataTransfer: DataTransfer): File | null {
  for (const file of Array.from(dataTransfer.files)) {
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) return file
  }
  return null
}

function tagsToText(tags: CardTag[], tagType: TagType): string {
  return tags.filter((tag) => tag.tag_type === tagType).map((tag) => tag.value).join(', ')
}

function textToTags(text: string, tagType: TagType): CardTag[] {
  return text
    .split(/[,、]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({ tag_type: tagType, value }))
}

export function CardEditor({ card, initialFile = null, onSaved, onDeleted, onClose }: CardEditorProps) {
  const [title, setTitle] = useState(card?.title ?? '')
  const [brief, setBrief] = useState(card?.brief ?? '')
  const [role, setRole] = useState<CardRole | ''>(card?.role ?? '')
  const [tone, setTone] = useState<CardTone | ''>(card?.tone ?? '')
  const [tagTexts, setTagTexts] = useState<Record<TagType, string>>({
    place: tagsToText(card?.tags ?? [], 'place'),
    time: tagsToText(card?.tags ?? [], 'time'),
    mood: tagsToText(card?.tags ?? [], 'mood')
  })
  const [pendingFile, setPendingFile] = useState<File | null>(initialFile)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isPlayingVideo, setIsPlayingVideo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [similar, setSimilar] = useState<Card[] | null>(null)
  const [similarLoading, setSimilarLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 別カードの編集に切り替わったらフォームを入れ替える
  useEffect(() => {
    setTitle(card?.title ?? '')
    setBrief(card?.brief ?? '')
    setRole(card?.role ?? '')
    setTone(card?.tone ?? '')
    setTagTexts({
      place: tagsToText(card?.tags ?? [], 'place'),
      time: tagsToText(card?.tags ?? [], 'time'),
      mood: tagsToText(card?.tags ?? [], 'mood')
    })
    setPendingFile(initialFile ?? null)
    setIsPlayingVideo(false)
    setSimilar(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id])

  const buildInput = (): CardInput => ({
    title: title.trim(),
    brief: brief.trim(),
    role: role || null,
    tone: role === 'ending' && tone ? tone : null,
    tags: TAG_FIELDS.flatMap(({ type }) => textToTags(tagTexts[type], type))
  })

  const handleSave = async () => {
    if (!title.trim() || !brief.trim()) {
      setError('タイトルとブリーフは必須です。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let saved = card
        ? await api.updateCard(card.id, buildInput())
        : await api.createCard(buildInput())
      if (pendingFile) {
        saved = await api.uploadMedia(saved.id, pendingFile)
        setPendingFile(null)
      }
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!card) return
    if (!window.confirm(`「${card.title}」を削除しますか？`)) return
    setSaving(true)
    try {
      await api.deleteCard(card.id)
      onDeleted(card.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const handleCheckSimilar = async () => {
    if (!brief.trim()) return
    setSimilarLoading(true)
    setError(null)
    try {
      const result = await api.similarByText(brief.trim(), 5)
      setSimilar(result.cards.filter((item) => item.id !== card?.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSimilarLoading(false)
    }
  }

  // オブジェクト URL はファイル単位でメモ化する。
  // レンダー毎に作り直すと <video> の src が変わって再生が先頭に戻る（+ URL リーク）
  const pendingFileUrl = useMemo(() => (pendingFile ? URL.createObjectURL(pendingFile) : null), [pendingFile])
  // 解放は「前のファイルの URL」のみ。effect のクリーンアップで現行 URL を revoke すると
  // StrictMode の 2 重実行（実行→クリーンアップ→再実行）で生きている URL を殺してしまう
  const prevPendingUrl = useRef<string | null>(null)
  useEffect(() => {
    if (prevPendingUrl.current && prevPendingUrl.current !== pendingFileUrl) {
      URL.revokeObjectURL(prevPendingUrl.current)
    }
    prevPendingUrl.current = pendingFileUrl
  }, [pendingFileUrl])

  const previewUrl =
    pendingFileUrl ??
    (card?.media_path ? `${cardFileUrl(card.id, true)}&v=${encodeURIComponent(card.updated_at)}` : null)

  const inputClass =
    'w-full rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-[15px] font-semibold">{card ? 'カードを編集' : '新規カード'}</h2>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="rounded px-2 py-1 text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* メディア（クリックで選択、保存済み動画はクリックで再生 / ドラッグ&ドロップ対応） */}
        <div>
          <div
            className={`relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-[var(--bg-canvas)] ${
              isDragOver ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)]'
            }`}
            onClick={() => {
              // 保存済みの動画はクリックで再生/停止。それ以外はファイル選択
              if (!pendingFile && card?.media_type === 'video' && card.media_path) {
                setIsPlayingVideo((playing) => !playing)
              } else {
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragOver(true)
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragOver(false)
              const file = pickMediaFile(event.dataTransfer)
              if (file) {
                setIsPlayingVideo(false)
                setPendingFile(file)
              }
            }}
            title={
              !pendingFile && card?.media_type === 'video' && card.media_path
                ? 'クリックで再生/停止。差し替えは「ファイル変更」'
                : 'クリックして選択、またはファイルをドロップ'
            }
          >
            {isDragOver ? (
              <span className="pointer-events-none text-[13px] text-[var(--text)]">ここにドロップ</span>
            ) : previewUrl ? (
              pendingFile?.type.startsWith('video') ? (
                // 選択直後の動画はその場で再生プレビュー
                <video src={previewUrl} muted autoPlay loop playsInline className="pointer-events-none h-full w-full object-cover" />
              ) : !pendingFile && card?.media_type === 'video' ? (
                isPlayingVideo ? (
                  <video
                    src={cardFileUrl(card.id, false)}
                    controls
                    autoPlay
                    playsInline
                    className="h-full w-full bg-black object-contain"
                    onClick={(event) => event.stopPropagation()}
                    onEnded={() => setIsPlayingVideo(false)}
                  />
                ) : (
                  // 保存済みの動画はサムネイル + 再生ヒント
                  <div className="pointer-events-none relative h-full w-full">
                    <img
                      src={previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="rounded-full bg-black/55 p-2.5 text-white/90">
                        <IconPlay size={18} />
                      </span>
                    </span>
                    <span className="absolute bottom-1 right-1 rounded bg-black/60 p-0.5 text-white/90">
                      <IconFilm size={11} />
                    </span>
                  </div>
                )
              ) : (
                <img src={previewUrl} alt="" className="pointer-events-none h-full w-full object-cover" />
              )
            ) : (
              <span className="text-[13px] text-[var(--text-faint)]">クリックして選択、またはドロップで追加</span>
            )}

            {/* 保存済み動画のときの差し替え導線（クリックは再生に割り当てているため） */}
            {!pendingFile && card?.media_type === 'video' && card.media_path && !isDragOver && (
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  fileInputRef.current?.click()
                }}
                className="absolute right-1.5 top-1.5 rounded bg-black/55 px-2 py-1 text-[11px] text-white/90 hover:bg-black/75"
              >
                ファイル変更
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
          />
          {pendingFile && (
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">保存時にアップロード: {pendingFile.name}</div>
          )}
        </div>

        {/* 基本情報 */}
        <label className="block">
          <span className="mb-1 block text-[12px] text-[var(--text-dim)]">タイトル（作者用の識別名）</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} maxLength={100} />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] text-[var(--text-dim)]">
            ブリーフ（LLM への指示・アイデア。完成文ではない）
          </span>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={5}
            maxLength={500}
            className={`${inputClass} leading-relaxed`}
          />
          <span className="mt-0.5 block text-right text-[11px] text-[var(--text-faint)]">{brief.length}/500</span>
        </label>

        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">ロール（任意）</span>
            <select value={role} onChange={(event) => setRole(event.target.value as CardRole | '')} className={inputClass}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">トーン（結末のみ）</span>
            <select
              value={tone}
              onChange={(event) => setTone(event.target.value as CardTone | '')}
              disabled={role !== 'ending'}
              className={`${inputClass} disabled:opacity-50`}
            >
              <option value="">未設定</option>
              {TONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* タグ */}
        {TAG_FIELDS.map(({ type, label, placeholder }) => (
          <label key={type} className="block">
            <span className="mb-1 block text-[12px] text-[var(--text-dim)]">{label}（カンマ区切り）</span>
            <input
              value={tagTexts[type]}
              onChange={(event) => setTagTexts((prev) => ({ ...prev, [type]: event.target.value }))}
              placeholder={placeholder}
              className={inputClass}
            />
          </label>
        ))}

        {/* 類似カード（重複検知） */}
        <section>
          <button
            onClick={() => void handleCheckSimilar()}
            disabled={similarLoading || !brief.trim()}
            className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
          >
            {similarLoading ? '検索中…' : '類似カードを確認（重複検知）'}
          </button>
          {similar !== null && (
            <ul className="mt-2 space-y-1">
              {similar.length === 0 && <li className="text-[12px] text-[var(--text-faint)]">類似カードはありません。</li>}
              {similar.map((item) => (
                <li key={item.id} className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate">{item.title}</span>
                    {item.distance !== undefined && (
                      <span className="shrink-0 text-[var(--text-faint)]">d={item.distance.toFixed(3)}</span>
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-faint)]">{item.brief}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

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
        {card && (
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
