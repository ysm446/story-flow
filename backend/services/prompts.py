"""生成用 system prompt の管理。

backend/prompts/*.md は「既定値」。ユーザーが UI から編集した上書き値は
data/prompts/*.md に保存し、存在すればそちらを優先する（既定に戻す = 上書きを削除）。
出力形式（JSON スキーマ）の指示は編集対象から分離し、writer.py 側で必ず付与する。
"""

from __future__ import annotations

from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DIR = Path(__file__).resolve().parents[1] / "prompts"
_OVERRIDE_DIR = _REPO_ROOT / "data" / "prompts"

PROMPT_NAMES = ("writer", "selector")


def _validate(name: str) -> None:
    if name not in PROMPT_NAMES:
        raise KeyError(f"unknown prompt: {name}")


def get_prompt(name: str) -> dict:
    """{name, default, override, effective} を返す。"""
    _validate(name)
    default = (_DEFAULT_DIR / f"{name}.md").read_text(encoding="utf-8")
    override_path = _OVERRIDE_DIR / f"{name}.md"
    override = override_path.read_text(encoding="utf-8") if override_path.exists() else None
    return {
        "name": name,
        "default": default,
        "override": override,
        "effective": override if override is not None else default,
    }


def set_override(name: str, content: str | None) -> dict:
    """上書きを保存する。None なら削除して既定に戻す。"""
    _validate(name)
    override_path = _OVERRIDE_DIR / f"{name}.md"
    if content is None or not content.strip():
        override_path.unlink(missing_ok=True)
    else:
        _OVERRIDE_DIR.mkdir(parents=True, exist_ok=True)
        override_path.write_text(content, encoding="utf-8", newline="\n")
    return get_prompt(name)


def effective_prompt(name: str) -> str:
    return get_prompt(name)["effective"]
