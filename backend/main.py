"""story-flow FastAPI バックエンドのエントリポイント。

起動は Electron main（electron/main/backend.ts）が venv の python で行う:
  .venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8600
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.db.database import LibraryNotOpen, open_library, resolve_initial_library_root
from backend.routes import cards, generate, library, prompts, stories, workspaces


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 前回のライブラリ（settings.json）→ 旧既定 data/library の順に解決。
    # どちらも無ければ未オープンのまま起動し、UI がライブラリピッカーを出す
    initial_root = resolve_initial_library_root()
    if initial_root is not None:
        open_library(initial_root, persist=False)
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
app.include_router(library.router)
app.include_router(prompts.router)
app.include_router(stories.router)
app.include_router(workspaces.router)


@app.exception_handler(LibraryNotOpen)
async def library_not_open_handler(_request: Request, _exc: LibraryNotOpen) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": "library not open"})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
