"""fill_gap — パズル型穴埋め（spec §6.2、v1.5 の本命）。

「候補検索 → LLM 選択」の二段。全在庫を LLM に見せない（spec 判断）:
  1. retrieve_candidates: sqlite-vec（A と B の中間ムード）+ role フィルタ + FTS → k 件
  2. select_card: k 件だけを LLM に提示し、A から B へ繋ぐ最良の 1 枚を理由付きで選ばせる

シグネチャは spec で確定済み。実装は v1.5。
"""

from __future__ import annotations

from backend.services.state import StoryState

CANDIDATE_K = 6  # 暫定既定値（spec §14）


def fill_gap(
    state: StoryState,
    prev_card: dict | None,
    next_anchor: dict,
    inventory: list[dict],
    target_role: str | None,
    target_tone: str | None,
    used_ids: set[str],
) -> tuple[dict, str]:
    """(選んだカード 1 枚, 理由) を返す。"""
    raise NotImplementedError("v1.5 で実装する")


def retrieve_candidates(
    state: StoryState,
    prev_card: dict | None,
    next_anchor: dict,
    target_role: str | None,
    target_tone: str | None,
    k: int = CANDIDATE_K,
    penalize: set[str] | None = None,
) -> list[dict]:
    """ベクトル + ロール + FTS のハイブリッドで候補 k 件に絞る。"""
    raise NotImplementedError("v1.5 で実装する")


def select_card(
    state: StoryState,
    prev_card: dict | None,
    next_anchor: dict,
    candidates: list[dict],
) -> tuple[dict, str]:
    """候補のブリーフ・ロール・タグだけを LLM に提示して 1 枚選ばせる（清書はさせない）。"""
    raise NotImplementedError("v1.5 で実装する")
