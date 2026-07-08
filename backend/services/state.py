"""StoryState — 逐次清書で持ち越す走行中メモリ（spec §5）。

writer が清書と同時に更新後の state を構造化出力する（別途抽出パスは立てない）。
肥大化を防ぐため各リストに上限を設け、超過分は古い/些末な項目から落とす。
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 各リストの上限（暫定値。チューニングは v1 実装中に行う）
MAX_CHARACTERS = 8
MAX_ITEMS = 10
MAX_EVENTS = 15


@dataclass
class StoryState:
    characters: list[dict] = field(default_factory=list)  # [{"name": "...", "traits": "..."}]
    items: list[str] = field(default_factory=list)        # ["赤い傘", ...]
    events: list[str] = field(default_factory=list)       # ["二人は別れた", ...] 時系列に追記
    location: str | None = None
    time: str | None = None
    tone_so_far: str | None = None                        # ここまでの語りの色

    @classmethod
    def empty(cls) -> "StoryState":
        return cls()

    @classmethod
    def from_dict(cls, data: dict) -> "StoryState":
        state = cls(
            characters=list(data.get("characters") or []),
            items=list(data.get("items") or []),
            events=list(data.get("events") or []),
            location=data.get("location"),
            time=data.get("time"),
            tone_so_far=data.get("tone_so_far"),
        )
        state.truncate()
        return state

    def snapshot(self) -> dict:
        """story_scenes.state_after に保存する JSON 互換 dict。"""
        return {
            "characters": self.characters,
            "items": self.items,
            "events": self.events,
            "location": self.location,
            "time": self.time,
            "tone_so_far": self.tone_so_far,
        }

    def truncate(self) -> None:
        """上限超過分を古いものから落とす（events は時系列なので先頭から）。"""
        self.characters = self.characters[:MAX_CHARACTERS]
        self.items = self.items[-MAX_ITEMS:]
        self.events = self.events[-MAX_EVENTS:]
