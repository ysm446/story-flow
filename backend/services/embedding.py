"""Qwen3-Embedding-4B（GGUF）による埋め込み計算。

llama-server（--embedding --pooling last で起動）の OpenAI 互換 /v1/embeddings を
HTTP で叩く。サーバのライフサイクルは Electron main（embeddingServer.ts）が管理し、
このモジュールはエンドポイント URL（環境変数で注入）を使うだけ。

埋め込みは常にカードのブリーフに対して計算する。清書文は index しない（spec §1.4）。
サーバ未起動時は EmbeddingUnavailable を投げ、呼び出し側は埋め込み無しで続行できる。
"""

from __future__ import annotations

import os

import httpx

EMBEDDING_BASE_URL = os.environ.get("STORY_FLOW_EMBEDDING_URL", "http://127.0.0.1:8091")
EMBED_TIMEOUT_SECONDS = 120.0


class EmbeddingUnavailable(RuntimeError):
    """埋め込みサーバに接続できない/失敗した。"""


def is_available() -> bool:
    try:
        response = httpx.get(f"{EMBEDDING_BASE_URL}/health", timeout=3.0)
        return response.status_code == 200
    except httpx.HTTPError:
        return False


def embed_text(text: str) -> list[float]:
    """テキスト 1 件の埋め込みベクトルを返す。"""
    try:
        response = httpx.post(
            f"{EMBEDDING_BASE_URL}/v1/embeddings",
            json={"input": text, "model": "embedding"},
            timeout=EMBED_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise EmbeddingUnavailable(f"embedding server unavailable: {error}") from error

    payload = response.json()
    try:
        return payload["data"][0]["embedding"]
    except (KeyError, IndexError, TypeError) as error:
        raise EmbeddingUnavailable(f"unexpected embeddings response: {payload}") from error
