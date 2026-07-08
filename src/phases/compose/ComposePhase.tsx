/**
 * Compose: 構成。始点・中間（複数可）・終点ノードを React Flow で置いて繋ぐ。
 * v1 ではエッジは「並び順 = 次に来る」のみ。lm-graph のキャンバス実装
 * （ReactFlowProvider / useNodesState / カスタムノード / RoundedSmoothStepEdge）を下敷きにする。
 */
export function ComposePhase() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-[18px] font-semibold">Compose — 構成</h1>
      <p className="mt-1 text-[13px] text-[var(--text-dim)]">
        アンカー（始点・中間・終点）を置いて物語の骨格を組むフェーズ。React Flow キャンバスをここに実装する
        （v1 作業順序ではフェーズ 4 = 最後）。
      </p>
    </div>
  )
}
