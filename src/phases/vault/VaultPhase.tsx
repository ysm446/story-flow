import { useEffect, useState } from 'react'
import { api, type VaultStats } from '../../lib/api'

const ROLE_LABELS: Array<{ key: keyof VaultStats['by_role']; label: string }> = [
  { key: 'intro', label: '導入' },
  { key: 'rising', label: '展開' },
  { key: 'turn', label: '転換' },
  { key: 'climax', label: 'クライマックス' },
  { key: 'ending', label: '結末' }
]

/**
 * Vault: 素材（シーンカード）の入出力。
 * v1 で CRUD / メディア登録 / タグ・ロール入力 / 一覧・検索 / 在庫密度パネルをここに実装する。
 */
export function VaultPhase() {
  const [stats, setStats] = useState<VaultStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    void api
      .vaultStats()
      .then((next) => {
        if (!canceled) setStats(next)
      })
      .catch((cause) => {
        if (!canceled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      canceled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-[18px] font-semibold">Vault — 素材</h1>
      <p className="mt-1 text-[13px] text-[var(--text-dim)]">
        シーンカード（メディア + ブリーフ + タグ + ロール）を登録・検索するフェーズ。実装予定: カード
        CRUD、メディアアップロード、埋め込み計算、類似検索、在庫密度パネル。
      </p>

      <section className="mt-6">
        <h2 className="text-[14px] font-semibold text-[var(--text-dim)]">在庫密度（ロール別）</h2>
        {error && <div className="mt-2 text-[13px] text-[var(--danger)]">バックエンドに接続できません: {error}</div>}
        {stats && (
          <div className="mt-3 grid grid-cols-5 gap-3">
            {ROLE_LABELS.map(({ key, label }) => (
              <div key={key} className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-3 text-center">
                <div className="text-[20px] font-semibold">{stats.by_role[key] ?? 0}</div>
                <div className="mt-1 text-[12px] text-[var(--text-dim)]">{label}</div>
              </div>
            ))}
          </div>
        )}
        {stats && (
          <div className="mt-2 text-[12px] text-[var(--text-faint)]">全 {stats.total} 枚</div>
        )}
      </section>
    </div>
  )
}
