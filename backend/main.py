"""story-flow FastAPI バックエンドのエントリポイント。

起動は Electron main（electron/main/backend.ts）が venv の python で行う:
  .venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8600
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.database import init_db
from backend.routes import cards, generate, prompts, stories, workspaces


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="story-flow backend", lifespan=lifespan)

# ローカル専用アプリ（dev: Vite の localhost、prod: file:// 由来の Origin）のため全許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cards.router)
app.include_router(generate.router)
app.include_router(prompts.router)
app.include_router(stories.router)
app.include_router(workspaces.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
