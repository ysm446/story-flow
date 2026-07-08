"""write_scene — 1 シーンの清書（spec §9.1）。

清書と同時に更新後の StoryState を構造化出力で受け取る（別途抽出パスは立てない）。
system prompt はユーザー編集可能な本文（prompts サービス）+ システム側で必ず付与する
出力形式指示（OUTPUT_FORMAT_INSTRUCTION）の 2 層で組み立てる。
"""

from __future__ import annotations

import json

from backend.services.llm import chat_completion_json
from backend.services.state import StoryState

# 編集対象から分離した出力形式指示。壊されると生成が止まるためシステム側で必ず付与する
OUTPUT_FORMAT_INSTRUCTION = """
## 出力形式（必須）

次のキーを持つ JSON オブジェクトのみを出力する。コードフェンスや説明文は付けない。

{
  "prose": "このシーンの清書文（日本語の地の文）",
  "state": {
    "characters": [{"name": "登場人物名", "traits": "特徴・関係性"}],
    "items": ["物語上意味を持つ持ち物・小道具"],
    "events": ["確定した出来事（時系列に、過去分も含めて）"],
    "location": "現在の場所（不明なら null）",
    "time": "現在の時間帯・時期（不明なら null）",
    "tone_so_far": "ここまでの語りの色（例: 穏やか、陰りを帯びる）"
  }
}

state はこのシーン終了時点の「確定事実」の全体像。前のシーンから引き継いだ事実を残しつつ、
このシーンで新しく確定した事実を追記して返す。
""".strip()

POSITION_LABELS = {
    "opening": "物語の書き出し（導入）",
    "middle": "物語の途中",
    "ending": "物語の結末（最終シーン）",
}


def write_scene(
    card: dict,
    state: StoryState,
    plot: str,
    target_tone: str | None,
    position: str,
    base_url: str,
    system_prompt: str,
) -> tuple[str, StoryState]:
    """カード 1 枚を清書し、(prose, 更新後 StoryState) を返す。"""
    system = f"{system_prompt.strip()}\n\n{OUTPUT_FORMAT_INSTRUCTION}"
    user = _build_user_prompt(card, state, plot, target_tone, position)

    result = chat_completion_json(base_url, system, user)

    prose = result.get("prose")
    if not isinstance(prose, str) or not prose.strip():
        raise ValueError("writer output has no prose")

    raw_state = result.get("state")
    next_state = StoryState.from_dict(raw_state) if isinstance(raw_state, dict) else state
    return prose.strip(), next_state


def _build_user_prompt(
    card: dict,
    state: StoryState,
    plot: str,
    target_tone: str | None,
    position: str,
) -> str:
    parts: list[str] = []
    if plot.strip():
        parts.append(f"## 物語全体のプロット\n{plot.strip()}")

    parts.append(
        "## これまでの確定事実（StoryState）\n"
        + json.dumps(state.snapshot(), ensure_ascii=False, indent=2)
    )

    scene_info = [
        f"- 位置: {POSITION_LABELS.get(position, position)}",
        f"- ロール: {card.get('role')}",
    ]
    if position == "ending" and target_tone:
        scene_info.append(f"- 着地させるトーン: {target_tone}")
    parts.append("## 今回のシーン\n" + "\n".join(scene_info))

    parts.append(f"## このシーンのブリーフ（作者の指示・アイデア）\n{card.get('brief', '')}")
    parts.append("上記ブリーフを、確定事実と矛盾しない 1 シーンの地の文に清書してください。")
    return "\n\n".join(parts)
