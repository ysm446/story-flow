"""生成用 system prompt の取得・編集 API。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.prompts import get_prompt, set_override

router = APIRouter(tags=["prompts"])


class PromptOverrideInput(BaseModel):
    override: str | None = None


@router.get("/prompts/{name}")
def read_prompt(name: str) -> dict:
    try:
        return get_prompt(name)
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown prompt")


@router.put("/prompts/{name}")
def write_prompt(name: str, payload: PromptOverrideInput) -> dict:
    try:
        return set_override(name, payload.override)
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown prompt")
