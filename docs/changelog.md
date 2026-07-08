# Changelog

## 未リリース

### 2026-07-08 22:59 — フェーズ 0: アプリの足場

- Electron + React + TypeScript（electron-vite）+ FastAPI（venv）の骨格を実装
- 4 フェーズ（Vault / Compose / Generate / Theater）のタブ UI
- llama-server のアプリ内インストーラ（GitHub リリースから runtime/ へダウンロード・展開、
  進捗表示、キャンセル対応）と models/ 配下 GGUF のロード/停止 UI
- SQLite スキーマ（sqlite-vec / FTS5 含む）と Vault 在庫密度 API の初期実装
- `start.bat`（初回セットアップ + 起動）
