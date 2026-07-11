"""メディア配信の共通レスポンス（no-cache + ETag 再検証）。

メディア（カードの画像/動画・サムネイル・BGM 音源）は差し替え後も URL が変わらないため、
Cache-Control 無しだと Chromium のヒューリスティックキャッシュが古い内容を返し続ける
（画像 → 動画の差し替えが反映されないように見える。2026-07-11 作者報告）。

no-cache（使う前に毎回サーバへ再確認）を付けた上で、Starlette の FileResponse は
条件付きリクエストを解釈しないため、If-None-Match の照合はここで行い、
未変更なら 304（本文なし）で応答する。
"""

from __future__ import annotations

from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse, Response


def media_file_response(path: Path, request: Request) -> Response:
    stat = path.stat()
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, headers=headers)
