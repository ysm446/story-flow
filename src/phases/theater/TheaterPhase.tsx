/**
 * Theater: 鑑賞。生成済み story を Ken Burns（パン/ズーム）+ オート送り + クロスフェードで再生する。
 */
export function TheaterPhase() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-[18px] font-semibold">Theater — 鑑賞</h1>
      <p className="mt-1 text-[13px] text-[var(--text-dim)]">
        生成済みの物語を再生するフェーズ。Ken Burns エフェクト、テキスト長に応じたオート送り、
        クロスフェードをここに実装する。
      </p>
    </div>
  )
}
