"""生成用 system prompt のプリセット管理。

物語の種類に合わせてプロンプトを切り替えられるよう、名前付きプリセットを
複数管理する（追加・編集・削除・アクティブ切替）。

- 既定プロンプト: backend/prompts/{kind}.md（読み取り専用。削除・編集不可）
- ユーザープリセット: ライブラリルートの prompts.json に保存（作品と一緒に持ち運べる）
- アクティブが未設定（None）なら既定を使う
- 出力形式（JSON スキーマ）の指示は編集対象から分離し、writer.py 側で必ず付与する
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from backend.db.database import get_library_root

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DIR = Path(__file__).resolve().parents[1] / "prompts"
_LEGACY_STORE_PATH = _REPO_ROOT / "data" / "prompts" / "presets.json"

PROMPT_KINDS = ("writer", "selector")


def _store_path() -> Path:
    return get_library_root() / "prompts.json"


class PresetNotFound(KeyError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_kind(kind: str) -> None:
    if kind not in PROMPT_KINDS:
        raise KeyError(f"unknown prompt kind: {kind}")


def _default_content(kind: str) -> str:
    return (_DEFAULT_DIR / f"{kind}.md").read_text(encoding="utf-8")


def _empty_store() -> dict:
    return {kind: {"active_id": None, "presets": []} for kind in PROMPT_KINDS}


def _read_store_file(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_store() -> dict:
    store = _empty_store()
    loaded = _read_store_file(_store_path())
    if loaded is None:
        # 旧保存先（repo の data/prompts/presets.json）からの移行
        legacy = _read_store_file(_LEGACY_STORE_PATH)
        if legacy is not None:
            loaded = legacy
            for kind in PROMPT_KINDS:
                if isinstance(loaded.get(kind), dict):
                    store[kind]["active_id"] = loaded[kind].get("active_id")
                    store[kind]["presets"] = list(loaded[kind].get("presets") or [])
            _save_store(store)
            return store
    if loaded is not None:
        for kind in PROMPT_KINDS:
            if isinstance(loaded.get(kind), dict):
                store[kind]["active_id"] = loaded[kind].get("active_id")
                store[kind]["presets"] = list(loaded[kind].get("presets") or [])
    return store


def _save_store(store: dict) -> None:
    _store_path().write_text(
        json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
    )


def get_prompt_config(kind: str) -> dict:
    """{name, default, active_id, presets} を返す。"""
    _validate_kind(kind)
    store = _load_store()
    return {
        "name": kind,
        "default": _default_content(kind),
        "active_id": store[kind]["active_id"],
        "presets": store[kind]["presets"],
    }


def create_preset(kind: str, name: str, content: str | None = None) -> dict:
    _validate_kind(kind)
    store = _load_store()
    preset = {
        "id": str(uuid.uuid4()),
        "name": name.strip() or "新しいプロンプト",
        "content": content if content is not None else _default_content(kind),
        "created_at": _now(),
        "updated_at": _now(),
    }
    store[kind]["presets"].append(preset)
    _save_store(store)
    return preset


def update_preset(kind: str, preset_id: str, name: str | None = None, content: str | None = None) -> dict:
    _validate_kind(kind)
    store = _load_store()
    for preset in store[kind]["presets"]:
        if preset["id"] == preset_id:
            if name is not None and name.strip():
                preset["name"] = name.strip()
            if content is not None:
                preset["content"] = content
            preset["updated_at"] = _now()
            _save_store(store)
            return preset
    raise PresetNotFound(preset_id)


def delete_preset(kind: str, preset_id: str) -> None:
    _validate_kind(kind)
    store = _load_store()
    presets = store[kind]["presets"]
    if not any(preset["id"] == preset_id for preset in presets):
        raise PresetNotFound(preset_id)
    store[kind]["presets"] = [preset for preset in presets if preset["id"] != preset_id]
    if store[kind]["active_id"] == preset_id:
        store[kind]["active_id"] = None  # 既定に戻す
    _save_store(store)


def set_active(kind: str, preset_id: str | None) -> dict:
    """アクティブなプリセットを切り替える。None = 既定。"""
    _validate_kind(kind)
    store = _load_store()
    if preset_id is not None and not any(p["id"] == preset_id for p in store[kind]["presets"]):
        raise PresetNotFound(preset_id)
    store[kind]["active_id"] = preset_id
    _save_store(store)
    return get_prompt_config(kind)


def effective_prompt(kind: str) -> str:
    """生成に使う system prompt（アクティブなプリセット or 既定）。"""
    _validate_kind(kind)
    store = _load_store()
    active_id = store[kind]["active_id"]
    if active_id:
        for preset in store[kind]["presets"]:
            if preset["id"] == active_id:
                return preset["content"]
    return _default_content(kind)


def preset_content(kind: str, preset_id: str) -> str | None:
    """指定 ID のプリセット本文。見つからなければ None（呼び出し側でフォールバック）。"""
    _validate_kind(kind)
    store = _load_store()
    for preset in store[kind]["presets"]:
        if preset["id"] == preset_id:
            return preset["content"]
    return None
