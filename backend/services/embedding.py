"""Qwen3-Embedding-4B（GGUF）による埋め込み計算。

llama-server を --embedding で起動した OpenAI 互換 /v1/embeddings を HTTP で叩く
（image-assistant の embedding_client.py と同方式・同モデル。ほぼそのまま移植できる）。

埋め込みは常にカードのブリーフに対して計算する。清書文は index しない（spec §1.4）。

TODO(フェーズ 1): embed_text() の実装と card_vec への upsert。
  EMBED_DIM（backend/db/database.py, 2560 想定）を初回接続時に実測確認すること。
"""

from __future__ import annotations

import os

EMBEDDING_BASE_URL = os.environ.get("STORY_FLOW_EMBEDDING_URL", "http://127.0.0.1:8091")


def embed_text(text: str) -> list[float]:
    """ブリーフ 1 件の埋め込みベクトルを返す。"""
    raise NotImplementedError("フェーズ 1 で実装する")
