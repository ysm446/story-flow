import { useCallback, useEffect, useState } from 'react'
import { api, cardFileUrl, type Card, type CardRole, type VaultStats } from '../../lib/api'
import { CardEditor } from './CardEditor'

const ROLE_LABELS: Record<CardRole, string> = {
  intro: '導入',
  rising: '展開',
  turn: '転換',
  climax: 'クライマックス',
  ending: '結末'
}

const TONE_LABELS: Record<string, string> = {
  happy: 'ハッピー',
  bad: 'バッド',
  bitter: 'ビター',
  neutral: 'ニュートラル'
}

type SearchMode = 'keyword' | 'semantic'

/**
 * Vault: 素材（シーンカード）の登録・検索・在庫密度。
 */
export function VaultPhase() {
  const [cards, setCards] = useState<Card[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<VaultStats | null>(null)
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')
  const [roleFilter, setRoleFilter] = useState<CardRole | ''>('')
  const [editing, setEditing] = useState<Card | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.vaultStats())
    } catch {
      // stats はベストエフォート（一覧側のエラー表示に任せる）
    }
  }, [])

  const loadCards = useCallback(async () => {
    setError(null)
    try {
      const trimmed = query.trim()
      const result = await api.listCards({
        q: searchMode === 'keyword' && trimmed ? trimmed : undefined,
        semantic: searchMode === 'semantic' && trimmed ? trimmed : undefined,
        role: roleFilter || undefined
      })
      setCards(result.cards)
      setTotal(result.total)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [query, searchMode, roleFilter])

  useEffect(() => {
    void loadCards()
    void loadStats()
    // 初回 + フィルタ変更時（検索語はフォーム submit で反映）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter])

  const handleSaved = (saved: Card) => {
    setEditing(saved)
    void loadCards()
    void loadStats()
  }

  const handleDeleted = () => {
    setEditing(null)
    void loadCards()
    void loadStats()
  }

  const inputClass =
    'rounded border border-[var(--border-strong)] bg-[var(--bg-input)] px-2 py-1.5 text-[13px] focus:outline focus:outline-1 focus:outline-[var(--accent-border)]'

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          {/* ツールバー */}
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void loadCards()
              }}
            >
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchMode === 'keyword' ? 'キーワード検索（FTS）' : '意味検索（ベクトル）'}
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

            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as CardRole | '')}
              className={inputClass}
              title="ロールで絞り込み"
            >
              <option value="">すべてのロール</option>
              {(Object.keys(ROLE_LABELS) as CardRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>

            <button
              onClick={() => setEditing('new')}
              className="ml-auto rounded bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              ＋ 新規カード
            </button>
          </div>

          {/* 在庫密度 */}
          {stats && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-dim)]">
              {(Object.keys(ROLE_LABELS) as CardRole[]).map((role) => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(roleFilter === role ? '' : role)}
                  className={`rounded-full border px-2.5 py-1 ${
                    roleFilter === role
                      ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)]'
                  } ${stats.by_role[role] === 0 ? 'opacity-60' : ''}`}
                  title={stats.by_role[role] === 0 ? 'このロールの在庫がありません' : ''}
                >
                  {ROLE_LABELS[role]} <span className="font-semibold">{stats.by_role[role]}</span>
                </button>
              ))}
              <span className="ml-2">
                全 {stats.total} 枚 ・ 埋め込み済み {stats.embedded} 枚
                {stats.total > stats.embedded && (
                  <span className="text-[var(--danger)]">（未計算 {stats.total - stats.embedded} 枚）</span>
                )}
              </span>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-[var(--danger)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[13px] text-[var(--danger)]">
              {error}
            </div>
          )}

          {/* カードグリッド */}
          {cards.length === 0 && !error ? (
            <div className="mt-16 text-center text-[13px] text-[var(--text-faint)]">
              カードがありません。「＋ 新規カード」から素材を登録してください。
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {cards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => setEditing(card)}
                  className={`overflow-hidden rounded-md border text-left transition-colors ${
                    editing !== 'new' && editing?.id === card.id
                      ? 'border-[var(--accent-border)]'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                  } bg-[var(--bg-card)]`}
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden bg-[var(--bg-canvas)]">
                    {card.media_path ? (
                      card.media_type === 'video' ? (
                        <span className="text-[12px] text-[var(--text-faint)]">🎬 動画</span>
                      ) : (
                        <img
                          src={`${cardFileUrl(card.id, true)}&v=${encodeURIComponent(card.updated_at)}`}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )
                    ) : (
                      <span className="text-[20px] opacity-30">📄</span>
                    )}
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{card.title}</span>
                      {!card.has_embedding && (
                        <span className="shrink-0 text-[10px] text-[var(--danger)]" title="埋め込み未計算">
                          ⚠
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
                      {card.brief}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 text-[10px]">
                      <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--text-dim)]">
                        {ROLE_LABELS[card.role]}
                      </span>
                      {card.tone && (
                        <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-faint)]">
                          {TONE_LABELS[card.tone]}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {total > cards.length && (
            <div className="mt-3 text-center text-[12px] text-[var(--text-faint)]">
              {total} 件中 {cards.length} 件を表示
            </div>
          )}
        </div>
      </div>

      {editing !== null && (
        <CardEditor
          card={editing === 'new' ? null : editing}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
