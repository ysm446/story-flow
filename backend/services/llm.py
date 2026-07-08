"""llama.cpp（OpenAI 互換）クライアント。

writer（清書）と selector（カード選択, v1.5）でエンドポイント/モデルを分けられる設定にする。
サーバのライフサイクルは Electron main が管理し、ここではエンドポイント URL を使うだけ。
Ornith 系推論モデルを使う場合は <think>...</think> ブロックを剥がすパーサを噛ませる。

TODO(フェーズ 2): chat_completion() の実装（httpx、構造化出力 JSON の強制とリトライ）。
"""

from __future__ import annotations

import os

# エンドポイントは環境変数で受ける（Electron main / start.bat から注入する想定）
WRITER_BASE_URL = os.environ.get("STORY_FLOW_WRITER_URL", "http://127.0.0.1:8080")
SELECTOR_BASE_URL = os.environ.get("STORY_FLOW_SELECTOR_URL", WRITER_BASE_URL)


def chat_completion_json(base_url: str, system_prompt: str, user_prompt: str) -> dict:
    """OpenAI 互換 /v1/chat/completions を叩き、JSON で構造化出力を受ける。"""
    raise NotImplementedError("フェーズ 2 で実装する")


def strip_think_block(text: str) -> str:
    """推論モデルの <think>...</think> を剥がす。"""
    raise NotImplementedError("フェーズ 2 で実装する")
