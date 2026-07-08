"""メディア（画像・短尺動画）のディスク保存とサムネイル生成。

image-assistant の image_library.py と同方式:
- ファイル名は sha256 の先頭 16 桁 + 拡張子（内容が同じなら同名になり重複しない）
- 原本は data/library/media/、サムネイルは data/library/thumbs/<hash>.jpg
- DB にはライブラリルート相対パスのみ保存する
- 動画のサムネイルは ffmpeg でフレーム抽出する（ffmpeg が無ければサムネイル無しで続行）
"""

from __future__ import annotations

import hashlib
import io
import subprocess
from pathlib import Path

from PIL import Image

from backend.db.database import get_media_dir, get_thumbs_dir, to_relative

THUMB_MAX = 420
THUMB_QUALITY = 88

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi"}


def detect_media_type(filename: str) -> str | None:
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    return None


def save_media(data: bytes, original_name: str) -> tuple[str, str]:
    """メディアを保存し (ライブラリルート相対パス, media_type) を返す。"""
    media_type = detect_media_type(original_name)
    if media_type is None:
        raise ValueError(f"unsupported media type: {original_name}")

    ext = Path(original_name).suffix.lower()
    digest = hashlib.sha256(data).hexdigest()[:16]
    dest = get_media_dir() / f"{digest}{ext}"
    if not dest.exists():
        dest.write_bytes(data)

    _ensure_thumbnail(dest, media_type, digest, data)
    return to_relative(dest), media_type


def thumb_relative_for(media_relative: str) -> str:
    """メディア相対パスから対応するサムネイル相対パスを導出する（存在保証はしない）。"""
    stem = Path(media_relative).stem
    return f"thumbs/{stem}.jpg"


def _ensure_thumbnail(media_path: Path, media_type: str, digest: str, data: bytes) -> None:
    thumb_path = get_thumbs_dir() / f"{digest}.jpg"
    if thumb_path.exists():
        return
    try:
        if media_type == "image":
            _make_image_thumbnail(data, thumb_path)
        else:
            _make_video_thumbnail(media_path, thumb_path)
    except Exception as error:  # サムネイル生成失敗は致命ではない
        print(f"[media] thumbnail generation failed for {media_path.name}: {error}")


def _make_image_thumbnail(data: bytes, thumb_path: Path) -> None:
    with Image.open(io.BytesIO(data)) as image:
        image = image.convert("RGB")
        image.thumbnail((THUMB_MAX, THUMB_MAX))
        image.save(thumb_path, "JPEG", quality=THUMB_QUALITY)


def _make_video_thumbnail(media_path: Path, thumb_path: Path) -> None:
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            "0.5",
            "-i",
            str(media_path),
            "-frames:v",
            "1",
            "-vf",
            f"scale='min({THUMB_MAX},iw)':-2",
            str(thumb_path),
        ],
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace")[-300:])
