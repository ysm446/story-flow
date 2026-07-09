"""BGM の自動選曲（spec の「候補検索 → LLM 選択」パターン）。

各シーンのムード（tone_so_far 等）でベクトル検索して候補を数件に絞り、直前の曲を
そのまま「継続」する選択肢も与えて LLM に 1 つ選ばせる。

- 手動指名（Compose のノードで曲を指定）があれば LLM を回さずそれを使う。
- 埋め込みサーバ / LLM が使えないときは直前の曲を継続（無ければ無音）に劣化する。
"""

from __future__ import annotations

from sqlite_vec import serialize_float32

from backend.db.database import get_connection
from backend.services.embedding import EmbeddingUnavailable, embed_text
from backend.services.llm import LlmError, chat_completion_json

CANDIDATE_K = 6  # 候補件数（plan.md の暫定値）

_SELECTOR_SYSTEM_PROMPT = (
    "あなたは物語の各シーンに合う BGM を選ぶ音響監督です。"
    "与えられたシーンの雰囲気と候補曲（説明付き）から、最もふさわしい 1 曲を選びます。"
    "曲の切り替えは頻繁にせず、直前と同じ雰囲気が続くなら『継続』を選んでください。"
    'かならず {"choice": "<曲ID または continue>"} の JSON だけを出力します。'
)


def _retrieve_candidates(conn, query_text: str, k: int) -> list[dict]:
    """ムード文でベクトル検索し、候補 BGM（説明付き）を返す。"""
    vector = embed_text(query_text)  # EmbeddingUnavailable は呼び出し側で捕捉
    rows = conn.execute(
        "SELECT bgm_id, distance FROM bgm_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
        (serialize_float32(vector), k),
    ).fetchall()
    candidates = []
    for row in rows:
        meta = conn.execute(
            "SELECT id, title, description FROM bgm WHERE id = ?", (row["bgm_id"],)
        ).fetchone()
        if meta is not None:
            candidates.append(dict(meta))
    return candidates


def _bgm_meta(conn, bgm_id: str | None) -> dict | None:
    if not bgm_id:
        return None
    row = conn.execute("SELECT id, title, description FROM bgm WHERE id = ?", (bgm_id,)).fetchone()
    return dict(row) if row is not None else None


def resolve_bgm(
    manual_bgm_id: str | None,
    prev_bgm_id: str | None,
    query_text: str,
    base_url: str,
    k: int = CANDIDATE_K,
) -> str | None:
    """このシーンで鳴らす bgm_id を決める。失敗時は直前の曲を継続する。"""
    if manual_bgm_id:
        return manual_bgm_id  # 手動指名を最優先

    query = query_text.strip()
    if not query:
        return prev_bgm_id

    conn = get_connection()
    try:
        try:
            candidates = _retrieve_candidates(conn, query, k)
        except EmbeddingUnavailable:
            return prev_bgm_id  # 埋め込みサーバ無し → 継続
        if not candidates:
            return prev_bgm_id
        prev_meta = _bgm_meta(conn, prev_bgm_id)
    finally:
        conn.close()

    lines = [f'- ID={c["id"]} / {c["title"]}: {c["description"] or "(説明なし)"}' for c in candidates]
    prev_line = (
        f'現在流れている曲: ID={prev_meta["id"]} / {prev_meta["title"]}: {prev_meta["description"] or "(説明なし)"}'
        if prev_meta
        else "現在流れている曲: なし"
    )
    user_prompt = (
        f"シーンの雰囲気:\n{query}\n\n"
        f"{prev_line}\n\n"
        f"候補曲:\n" + "\n".join(lines) + "\n\n"
        '最もふさわしい 1 曲の ID を選んでください。今の曲を続けるのが自然なら "continue" を選びます。'
        '出力は {"choice": "<ID または continue>"} のみ。'
    )

    try:
        result = chat_completion_json(base_url, _SELECTOR_SYSTEM_PROMPT, user_prompt, temperature=0.3)
    except LlmError:
        return prev_bgm_id

    choice = str(result.get("choice", "")).strip()
    if choice == "continue" or not choice:
        return prev_bgm_id
    valid_ids = {c["id"] for c in candidates}
    return choice if choice in valid_ids else prev_bgm_id
