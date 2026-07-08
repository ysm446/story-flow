"""llama.cpp（OpenAI 互換）クライアント。

writer（清書）と selector（カード選択, v1.5）でエンドポイント/モデルを分けられる。
サーバのライフサイクルは Electron main が管理し、ここではエンドポイント URL を使うだけ。
Ornith 系など推論モデルの <think>...</think> ブロックは剥がしてから JSON を取り出す。
"""

from __future__ import annotations

import json
import os
import re

import httpx

# 既定エンドポイント（環境変数で注入。リクエスト側から明示指定があればそちらを優先する）
WRITER_BASE_URL = os.environ.get("STORY_FLOW_WRITER_URL", "http://127.0.0.1:8080")
SELECTOR_BASE_URL = os.environ.get("STORY_FLOW_SELECTOR_URL", WRITER_BASE_URL)

LLM_TIMEOUT_SECONDS = 600.0
MAX_JSON_RETRIES = 2


class LlmError(RuntimeError):
    """LLM 呼び出しの失敗（接続不可・出力パース不能）。"""


def strip_think_block(text: str) -> str:
    """推論モデルの <think>...</think> を剥がす。閉じタグが無い場合も先頭ブロックを落とす。"""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"^.*?</think>", "", text, flags=re.DOTALL)  # 開きタグ欠落対策
    return text.strip()


def extract_json(text: str) -> dict:
    """LLM 出力から最初の JSON オブジェクトを取り出す。"""
    cleaned = strip_think_block(text)
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned.strip(), flags=re.MULTILINE)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise LlmError(f"no JSON object in LLM output: {cleaned[:200]!r}")
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as error:
        raise LlmError(f"invalid JSON from LLM: {error}") from error
    if not isinstance(parsed, dict):
        raise LlmError("LLM output JSON is not an object")
    return parsed


class _ProseStreamExtractor:
    """ストリーミング中の LLM 出力（JSON）から "prose" 文字列の中身だけを逐次取り出す。

    {"prose": "..." までを探し、以降は JSON 文字列のエスケープを解決しながら
    閉じクォートまでの文字を返す。state 以降のフィールドは無視（最後に全文をパースする）。
    """

    def __init__(self) -> None:
        self._phase = "search"  # search → in_string → done
        self._search_buffer = ""
        self._escaped = False
        self._unicode_hex: str | None = None

    def feed(self, chunk: str) -> str:
        if self._phase == "done":
            return ""
        output: list[str] = []
        remaining = chunk
        if self._phase == "search":
            self._search_buffer += chunk
            match = re.search(r'"prose"\s*:\s*"', self._search_buffer)
            if not match:
                return ""
            self._phase = "in_string"
            remaining = self._search_buffer[match.end():]
            self._search_buffer = ""
        for char in remaining:
            if self._phase != "in_string":
                break
            if self._unicode_hex is not None:
                self._unicode_hex += char
                if len(self._unicode_hex) == 4:
                    try:
                        output.append(chr(int(self._unicode_hex, 16)))
                    except ValueError:
                        pass
                    self._unicode_hex = None
                continue
            if self._escaped:
                self._escaped = False
                if char == "n":
                    output.append("\n")
                elif char == "t":
                    output.append("\t")
                elif char == "r":
                    pass
                elif char == "u":
                    self._unicode_hex = ""
                else:  # \" \\ \/ など
                    output.append(char)
                continue
            if char == "\\":
                self._escaped = True
            elif char == '"':
                self._phase = "done"
            else:
                output.append(char)
        return "".join(output)


def chat_completion_json_stream(
    base_url: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.8,
):
    """ストリーミング版。('delta', prose断片) を逐次 yield し、最後に ('done', dict) を yield する。

    ストリーム全文のパースに失敗した場合は非ストリーミング（リトライ付き）にフォールバック。
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    payload = {
        "model": "local-model",
        "messages": messages,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "stream": True,
    }
    extractor = _ProseStreamExtractor()
    content_parts: list[str] = []
    try:
        with httpx.stream(
            "POST",
            f"{base_url.rstrip('/')}/v1/chat/completions",
            json=payload,
            timeout=LLM_TIMEOUT_SECONDS,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[len("data: "):]
                if data.strip() == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0].get("delta", {}).get("content") or ""
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if delta:
                    content_parts.append(delta)
                    fragment = extractor.feed(delta)
                    if fragment:
                        yield ("delta", fragment)
    except httpx.HTTPError as error:
        raise LlmError(f"LLM server unavailable ({base_url}): {error}") from error

    try:
        parsed = extract_json("".join(content_parts))
    except LlmError:
        # ストリーム出力が壊れていた場合は非ストリーミングで作り直す
        parsed = chat_completion_json(base_url, system_prompt, user_prompt, temperature)
    yield ("done", parsed)


def chat_completion_json(
    base_url: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.8,
) -> dict:
    """OpenAI 互換 /v1/chat/completions を叩き、JSON オブジェクトを受け取る。

    response_format=json_object で文法制約をかけつつ、パース失敗時は
    修正指示を付けて限定回数リトライする。
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    last_error: LlmError | None = None
    for attempt in range(1 + MAX_JSON_RETRIES):
        content = _chat_completion(base_url, messages, temperature)
        try:
            return extract_json(content)
        except LlmError as error:
            last_error = error
            messages = messages + [
                {"role": "assistant", "content": content},
                {
                    "role": "user",
                    "content": "出力が不正でした。指定されたキーを持つ JSON オブジェクトのみを、"
                    "コードフェンスや説明を付けずに出力し直してください。",
                },
            ]
    raise last_error or LlmError("LLM returned no parsable JSON")


def _chat_completion(base_url: str, messages: list[dict], temperature: float) -> str:
    payload = {
        "model": "local-model",
        "messages": messages,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    try:
        response = httpx.post(
            f"{base_url.rstrip('/')}/v1/chat/completions",
            json=payload,
            timeout=LLM_TIMEOUT_SECONDS,
        )
        if response.status_code == 400:
            # response_format 未対応ビルドへのフォールバック
            payload.pop("response_format", None)
            response = httpx.post(
                f"{base_url.rstrip('/')}/v1/chat/completions",
                json=payload,
                timeout=LLM_TIMEOUT_SECONDS,
            )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise LlmError(f"LLM server unavailable ({base_url}): {error}") from error

    try:
        return response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise LlmError(f"unexpected chat completion response: {response.text[:300]}") from error
