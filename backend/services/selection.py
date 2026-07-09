"""fill_gap — パズル型穴埋め(spec §6.2、v1.5 の本命)。

「候補検索 → LLM 選択」の二段。全在庫を LLM に見せない(spec 判断):
  1. retrieve_candidates: sqlite-vec(A と B の中間ムード)+ ロールのスコアボーナス → k 件
  2. select_card: k 件だけを LLM に提示し、A から B へ繋ぐ最良の 1 枚を理由付きで選ばせる

- ロールは**ハードフィルタでなくスコアボーナス**(plan.md 2026-07-09。境界が曖昧でも破綻しない)。
  role 未設定カードは汎用としてペナルティなしで扱う。
- 劣化動作: 埋め込みが使えなければロール優先 + ランダムの候補に、LLM 選択が失敗すれば
  検索スコア最上位の候補に落とす(生成全体は止めない)。
"""

from __future__ import annotations

import json
import random
import struct

from sqlite_vec import serialize_float32

from backend.db.database import get_connection
from backend.services.embedding import EmbeddingUnavailable, embed_text
from backend.services.llm import LlmError, chat_completion_json
from backend.services.prompts import effective_prompt
from backend.services.state import StoryState

CANDIDATE_K = 6  # 候補件数(spec §14 の暫定値を既定として確定)
ROLE_BONUS = 0.15  # target_role 一致カードへの距離ボーナス(L2 正規化ベクトルの距離スケール前提)
SELECTOR_TEMPERATURE = 0.6  # 候補内の選択に幅を持たせる(リプレイ性。spec §7)
_KNN_POOL = 48  # ベクトル一次取得の件数。除外・加点のあとで k 件へ絞る

# 編集対象から分離した出力形式指示。壊されると生成が止まるためシステム側で必ず付与する
SELECTOR_OUTPUT_FORMAT = """
## 出力形式(必須)

次のキーを持つ JSON オブジェクトのみを出力する。コードフェンスや説明文は付けない。

{
  "card_id": "候補一覧に示された ID のいずれか",
  "reason": "そのカードを選んだ理由(日本語で 1〜2 文)"
}
""".strip()

_ROLE_LABELS = {
    "intro": "導入",
    "rising": "展開",
    "turn": "転換",
    "climax": "クライマックス",
    "ending": "結末",
}


def load_inventory(exclude: set[str]) -> list[dict]:
    """使用可能な在庫カード(使用済みを除外)。"""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM cards").fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows if row["id"] not in exclude]


def fill_gap(
    state: StoryState,
    prev_card: dict | None,
    next_anchor: dict | None,
    inventory: list[dict],
    target_role: str | None,
    target_tone: str | None,
    used_ids: set[str],
    *,
    base_url: str,
    system_prompt: str | None = None,
    plot: str = "",
) -> tuple[dict, str]:
    """(選んだカード 1 枚, 理由) を返す。在庫が空のときは LlmError。"""
    if not inventory:
        raise LlmError(
            "穴埋めに使えるカードが残っていません。"
            "Vault にカードを追加するか、おまかせスロットを減らしてください。"
        )
    candidates = retrieve_candidates(
        state, prev_card, next_anchor, target_role, target_tone,
        k=CANDIDATE_K, penalize=used_ids, inventory=inventory,
    )
    if not candidates:
        candidates = inventory[:CANDIDATE_K]
    if len(candidates) == 1:
        return candidates[0], "残っている候補が 1 枚のみだったため。"
    return select_card(
        state, prev_card, next_anchor, candidates,
        target_role=target_role, target_tone=target_tone,
        base_url=base_url, system_prompt=system_prompt, plot=plot,
    )


def retrieve_candidates(
    state: StoryState,
    prev_card: dict | None,
    next_anchor: dict | None,
    target_role: str | None,
    target_tone: str | None,
    k: int = CANDIDATE_K,
    penalize: set[str] | None = None,
    inventory: list[dict] | None = None,
) -> list[dict]:
    """ベクトル(A/B の中間)+ ロールのスコアボーナスで候補 k 件に絞る。

    埋め込みが一切使えない場合は、ロール優先 + ランダムの候補に劣化する。
    """
    exclude = set(penalize or set())
    if inventory is None:
        inventory = load_inventory(exclude=exclude)
    allowed = {card["id"]: card for card in inventory if card["id"] not in exclude}
    if not allowed:
        return []
    if len(allowed) <= k:
        return list(allowed.values())

    query_vector = _gap_query_vector(prev_card, next_anchor, state, target_tone)
    if query_vector is None:
        return _fallback_candidates(list(allowed.values()), target_role, k)

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT card_id, distance FROM card_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (serialize_float32(query_vector), _KNN_POOL),
        ).fetchall()
    finally:
        conn.close()

    scored: list[tuple[float, dict]] = []
    for row in rows:
        card = allowed.get(row["card_id"])
        if card is None:
            continue
        score = row["distance"]
        if target_role and card.get("role") == target_role:
            score -= ROLE_BONUS  # ロールはボーナス。未設定カードは汎用(ペナルティなし)
        scored.append((score, card))
    scored.sort(key=lambda item: item[0])
    picked = [card for _, card in scored[:k]]

    if len(picked) < k:
        # 埋め込み未計算のカードは KNN に出てこないため、残り枠を汎用候補として補充する
        picked_ids = {card["id"] for card in picked}
        rest = [card for card_id, card in allowed.items() if card_id not in picked_ids]
        picked.extend(_fallback_candidates(rest, target_role, k - len(picked)))
    return picked


def select_card(
    state: StoryState,
    prev_card: dict | None,
    next_anchor: dict | None,
    candidates: list[dict],
    *,
    target_role: str | None = None,
    target_tone: str | None = None,
    base_url: str,
    system_prompt: str | None = None,
    plot: str = "",
) -> tuple[dict, str]:
    """候補のブリーフ・ロール・タグだけを LLM に提示して 1 枚選ばせる(清書はさせない)。"""
    if not candidates:
        raise LlmError("カード選択の候補が空です。")

    system = f"{(system_prompt or effective_prompt('selector')).strip()}\n\n{SELECTOR_OUTPUT_FORMAT}"
    user = _build_selector_prompt(state, prev_card, next_anchor, candidates, target_role, target_tone, plot)

    try:
        result = chat_completion_json(base_url, system, user, temperature=SELECTOR_TEMPERATURE)
    except LlmError:
        # 選択の失敗で物語全体を止めない。検索スコア最上位に劣化
        return candidates[0], "(LLM の選択が失敗したため、検索スコア最上位の候補を採用)"

    choice = str(result.get("card_id", "")).strip()
    reason = str(result.get("reason", "")).strip() or "(理由なし)"
    for card in candidates:
        if card["id"] == choice:
            return card, reason
    return candidates[0], "(LLM が候補外の ID を返したため、検索スコア最上位の候補を採用)"


def _build_selector_prompt(
    state: StoryState,
    prev_card: dict | None,
    next_anchor: dict | None,
    candidates: list[dict],
    target_role: str | None,
    target_tone: str | None,
    plot: str,
) -> str:
    parts: list[str] = []
    if plot.strip():
        parts.append(f"## 物語全体のプロット\n{plot.strip()}")
    parts.append(
        "## これまでの確定事実(StoryState)\n"
        + json.dumps(state.snapshot(), ensure_ascii=False, indent=2)
    )
    parts.append(
        "## 直前のシーン A\n"
        + (f"{prev_card.get('title', '')}: {prev_card.get('brief', '')}" if prev_card else "(物語の先頭。まだシーンはない)")
    )
    parts.append(
        "## 次の固定シーン B(ここへ繋ぐ)\n"
        + (f"{next_anchor.get('title', '')}: {next_anchor.get('brief', '')}" if next_anchor else "(指定なし。自然な続きを選ぶ)")
    )

    conditions = []
    if target_role:
        conditions.append(f"- 望ましいロール: {_ROLE_LABELS.get(target_role, target_role)}(近いものを優先)")
    if target_tone:
        conditions.append(f"- 結末の目標トーン: {target_tone}(そこへ向かう引力になること)")
    if conditions:
        parts.append("## 求める条件\n" + "\n".join(conditions))

    tags_by_card = _load_tags_for(candidates)
    lines = []
    for card in candidates:
        role = _ROLE_LABELS.get(card.get("role") or "", card.get("role") or "汎用")
        tags = tags_by_card.get(card["id"], "")
        tag_part = f" / タグ: {tags}" if tags else ""
        lines.append(f'- ID={card["id"]} / {card.get("title", "")} / ロール: {role}{tag_part}\n  ブリーフ: {card.get("brief", "")}')
    parts.append("## 候補カード\n" + "\n".join(lines))
    parts.append("A から B へ最も自然に橋渡しできる 1 枚を選び、ID と理由を出力してください。")
    return "\n\n".join(parts)


def _load_tags_for(candidates: list[dict]) -> dict[str, str]:
    if not candidates:
        return {}
    ids = [card["id"] for card in candidates]
    placeholders = ",".join("?" * len(ids))
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT card_id, value FROM card_tags WHERE card_id IN ({placeholders})", tuple(ids)
        ).fetchall()
    finally:
        conn.close()
    tags: dict[str, list[str]] = {}
    for row in rows:
        tags.setdefault(row["card_id"], []).append(row["value"])
    return {card_id: " ".join(values) for card_id, values in tags.items()}


def _gap_query_vector(
    prev_card: dict | None,
    next_anchor: dict | None,
    state: StoryState,
    target_tone: str | None,
) -> list[float] | None:
    """A と B の保存済み埋め込みの中点。無ければ合成テキストを埋め込む。どちらも不可なら None。"""
    conn = get_connection()
    try:
        vectors = []
        for card in (prev_card, next_anchor):
            if card and card.get("id"):
                vector = _stored_embedding(conn, card["id"])
                if vector is not None:
                    vectors.append(vector)
    finally:
        conn.close()
    if len(vectors) == 2:
        return [(a + b) / 2.0 for a, b in zip(vectors[0], vectors[1])]
    if len(vectors) == 1:
        return vectors[0]

    text_parts = [card.get("brief") for card in (prev_card, next_anchor) if card]
    text_parts.extend([state.tone_so_far, target_tone])
    query = " ".join(part for part in text_parts if part).strip()
    if not query:
        return None
    try:
        return embed_text(query)
    except EmbeddingUnavailable:
        return None


def _stored_embedding(conn, card_id: str) -> list[float] | None:
    row = conn.execute("SELECT embedding FROM card_vec WHERE card_id = ?", (card_id,)).fetchone()
    if row is None:
        return None
    blob = row["embedding"]
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def _fallback_candidates(cards: list[dict], target_role: str | None, k: int) -> list[dict]:
    """ベクトルが使えないときの劣化候補: ロール一致を優先しつつランダム(リプレイ性)。"""
    if k <= 0:
        return []
    matching = [card for card in cards if target_role and card.get("role") == target_role]
    matching_ids = {card["id"] for card in matching}
    rest = [card for card in cards if card["id"] not in matching_ids]
    random.shuffle(matching)
    random.shuffle(rest)
    return (matching + rest)[:k]
