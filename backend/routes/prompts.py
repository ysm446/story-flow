"""生成用 system prompt プリセットの管理 API。

- GET    /prompts/{kind}                 # 既定 + プリセット一覧 + アクティブ ID
- POST   /prompts/{kind}/presets         # プリセット作成（content 省略時は既定を複製）
- PUT    /prompts/{kind}/presets/{id}    # 名前・本文の更新
- DELETE /prompts/{kind}/presets/{id}    # 削除（アクティブなら既定に戻る）
- PUT    /prompts/{kind}/active          # アクティブ切替（null = 既定）
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.prompts import (
    PresetNotFound,
    create_preset,
    delete_preset,
    get_prompt_config,
    set_active,
    update_preset,
)

router = APIRouter(tags=["prompts"])


class PresetCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    content: str | None = None


class PresetUpdateInput(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    content: str | None = None


class ActiveInput(BaseModel):
    preset_id: str | None = None


@router.get("/prompts/{kind}")
def read_prompt_config(kind: str) -> dict:
    try:
        return get_prompt_config(kind)
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown prompt kind")


@router.post("/prompts/{kind}/presets", status_code=201)
def create_prompt_preset(kind: str, payload: PresetCreateInput) -> dict:
    try:
        return create_preset(kind, payload.name, payload.content)
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown prompt kind")


@router.put("/prompts/{kind}/presets/{preset_id}")
def update_prompt_preset(kind: str, preset_id: str, payload: PresetUpdateInput) -> dict:
    try:
        return update_preset(kind, preset_id, payload.name, payload.content)
    except PresetNotFound:
        raise HTTPException(status_code=404, detail="preset not found")
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown prompt kind")


@router.delete("/prompts/{kind}/presets/{preset_id}")
def delete_prompt_preset(kind: str, preset_id: str) -> dict:
    try:
        delete_preset(kind, preset_id)
        return {"ok": True}
    except PresetNotFound:
        raise HTTPException(status_code=404, detail="preset not found")
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown prompt kind")


@router.put("/prompts/{kind}/active")
def set_active_prompt(kind: str, payload: ActiveInput) -> dict:
    try:
        return set_active(kind, payload.preset_id)
    except PresetNotFound:
        raise HTTPException(status_code=404, detail="preset not found")
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown prompt kind")
