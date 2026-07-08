"""write_scene — 1 シーンの清書（spec §9.1）。

入力: カードの brief + StoryState + target_tone + position
出力: (prose, 更新後 StoryState) — writer が清書と同時に state を構造化出力する。

system prompt は backend/prompts/writer.md を既定値とし、ユーザー上書き値を優先する。
出力形式（JSON スキーマ）指示は編集対象から分離してシステム側で必ず付与する。

TODO(フェーズ 2): 実装。
"""

from __future__ import annotations

from backend.services.state import StoryState


def write_scene(
    card: dict,
    state: StoryState,
    target_tone: str | None,
    position: str,
) -> tuple[str, StoryState]:
    """カード 1 枚を清書し、更新後の StoryState と共に返す。"""
    raise NotImplementedError("フェーズ 2 で実装する")
