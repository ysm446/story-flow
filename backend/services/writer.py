"""write_scene — 1 シーンの清書（spec §9.1）。

清書と同時に更新後の StoryState を構造化出力で受け取る（別途抽出パスは立てない）。
system prompt はユーザー編集可能な本文（prompts サービス）+ システム側で必ず付与する
出力形式指示（OUTPUT_FORMAT_INSTRUCTION）の 2 層で組み立てる。
"""

from __future__ import annotations

import json

from backend.services.llm import chat_completion_json, chat_completion_json_stream
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

# シーンの目安文字数（ローカル LLM は厳密には守らないため「目安」として指示する）
SCENE_LENGTH_CHARS = {
    "short": 150,
    "standard": 300,
    "long": 600,
}


def write_scene(
    card: dict,
    state: StoryState,
    plot: str,
    target_tone: str | None,
    position: str,
    base_url: str,
    system_prompt: str,
    scene_length: str | None = None,
    instruction: str | None = None,
    lore: list[dict] | None = None,
) -> tuple[str, StoryState]:
    """カード 1 枚を清書し、(prose, 更新後 StoryState) を返す。"""
    system = f"{system_prompt.strip()}\n\n{OUTPUT_FORMAT_INSTRUCTION}"
    user = _build_user_prompt(card, state, plot, target_tone, position, scene_length, instruction, lore=lore)

    result = chat_completion_json(base_url, system, user)
    return _parse_writer_result(result, state)


def write_scene_stream(
    card: dict,
    state: StoryState,
    plot: str,
    target_tone: str | None,
    position: str,
    base_url: str,
    system_prompt: str,
    scene_length: str | None = None,
    instruction: str | None = None,
    image_data_url: str | None = None,
    lore: list[dict] | None = None,
):
    """write_scene のストリーミング版 generator。

    ('delta', 清書文の断片) を逐次 yield し、最後に ('scene', prose, 更新後 StoryState) を yield する。
    image_data_url があれば vision 対応モデル向けにシーンのメディアを添付する。
    """
    system = f"{system_prompt.strip()}\n\n{OUTPUT_FORMAT_INSTRUCTION}"
    user = _build_user_prompt(
        card,
        state,
        plot,
        target_tone,
        position,
        scene_length,
        instruction,
        with_image=image_data_url is not None,
        lore=lore,
    )

    images = [image_data_url] if image_data_url else None
    result: dict | None = None
    for kind, payload in chat_completion_json_stream(base_url, system, user, images=images):
        if kind == "delta":
            yield ("delta", payload)
        else:
            result = payload
    prose, next_state = _parse_writer_result(result or {}, state)
    yield ("scene", prose, next_state)


def _parse_writer_result(result: dict, fallback_state: StoryState) -> tuple[str, StoryState]:
    prose = result.get("prose")
    if not isinstance(prose, str) or not prose.strip():
        raise ValueError("writer output has no prose")

    raw_state = result.get("state")
    next_state = StoryState.from_dict(raw_state) if isinstance(raw_state, dict) else fallback_state
    return prose.strip(), next_state


def _build_user_prompt(
    card: dict,
    state: StoryState,
    plot: str,
    target_tone: str | None,
    position: str,
    scene_length: str | None = None,
    instruction: str | None = None,
    with_image: bool = False,
    lore: list[dict] | None = None,
) -> str:
    parts: list[str] = []
    if plot.strip():
        parts.append(f"## 物語全体のプロット\n{plot.strip()}")

    # 背景設定（作品の恒久設定 = canon）。StoryState（一話内の発生事実）とは別レイヤ。
    # Phase 1 は全文注入（goals.md 設定資料 RAG。長文化したら関連チャンク検索に進化させる）
    lore_sections = [
        f"### {str(memo.get('title', '')).strip() or '(無題)'}\n{str(memo.get('body', '')).strip()}"
        for memo in (lore or [])
        if str(memo.get("body", "")).strip()
    ]
    if lore_sections:
        parts.append(
            "## 背景設定（この作品の恒久的な設定。全シーンで一貫させ、矛盾させない）\n"
            + "\n\n".join(lore_sections)
        )

    parts.append(
        "## これまでの確定事実（StoryState）\n"
        + json.dumps(state.snapshot(), ensure_ascii=False, indent=2)
    )

    scene_info = [f"- 位置: {POSITION_LABELS.get(position, position)}"]
    if card.get("role"):
        scene_info.append(f"- ロール: {card.get('role')}")
    if scene_length in SCENE_LENGTH_CHARS:
        scene_info.append(f"- 目安の長さ: 約 {SCENE_LENGTH_CHARS[scene_length]} 字（多少前後してよい）")
    if position == "ending" and target_tone:
        scene_info.append(f"- 着地させるトーン: {target_tone}")
    parts.append("## 今回のシーン\n" + "\n".join(scene_info))

    parts.append(f"## このシーンのブリーフ（作者の指示・アイデア）\n{card.get('brief', '')}")
    if instruction and instruction.strip():
        parts.append(f"## この作品でのこのシーンへの追加指示\n{instruction.strip()}")
    if with_image:
        parts.append(
            "## 添付画像\n添付した画像は、このシーンの背景として表示されるメディアです。"
            "写っている情景・色・光・人物の佇まいを描写に自然に反映してください（画像の説明文にはしない）。"
        )
    parts.append("上記ブリーフ（と追加指示があればそれも）を、確定事実と矛盾しない 1 シーンの地の文に清書してください。")
    return "\n\n".join(parts)
