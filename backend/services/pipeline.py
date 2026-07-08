"""generate() — 逐次生成パイプライン（spec §6.1、中核）。

選択と清書を 1 つの左→右ループに乗せる。一括生成は禁止（spec 判断）:
  for slot in flatten(composition):
      FIXED → そのカード / GAP → fill_gap()  # GAP は v1.5
      prose, state = write_scene(card, state, target_tone, position)
      used_ids に追加し、prev_card を更新

v1 では GAP が存在しない（Compose はアンカーのみ）ため FIXED だけを回す。
保存は save_story() で行い、清書結果は index しない。

TODO(フェーズ 2): 実装。SSE でシーン単位に push できる generator 形式にする。
"""

from __future__ import annotations

from backend.services.state import StoryState  # noqa: F401  (実装時に使用)


def generate(composition: dict, plot: str, target_tone: str | None) -> dict:
    """composition（アンカー列）から物語 1 本を逐次生成して保存する。"""
    raise NotImplementedError("フェーズ 2 で実装する")
