/**
 * Generate: 生成。アンカー列を左から 1 シーンずつ逐次清書し、StoryState を持ち越す。
 * バックエンド POST /generate（SSE でシーン毎 push）を受けて進行表示する。
 */
export function GeneratePhase() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-[18px] font-semibold">Generate — 生成</h1>
      <p className="mt-1 text-[13px] text-[var(--text-dim)]">
        逐次清書パイプラインの実行と進行表示のフェーズ。シーンが 1 枚ずつ埋まっていく様子を SSE
        で受信して表示する。生成用 system prompt の編集 UI もここに置く予定。
      </p>
    </div>
  )
}
