@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo === Story Flow 起動 ===

rem --- Python コマンドの決定（py ランチャー優先。python は Store スタブの場合があるため） ---
set "PY_CMD=py"
where py >nul 2>nul
if errorlevel 1 set "PY_CMD=python"

rem --- Python venv（初回のみ作成 + 依存インストール） ---
if not exist ".venv\Scripts\python.exe" (
    echo [setup] .venv を作成しています...
    %PY_CMD% -m venv .venv
    if errorlevel 1 (
        echo [error] venv の作成に失敗しました。Python がインストールされているか確認してください。
        pause
        exit /b 1
    )
    echo [setup] Python 依存をインストールしています...
    ".venv\Scripts\python.exe" -m pip install --upgrade pip
    ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
    if errorlevel 1 (
        echo [error] pip install に失敗しました。
        pause
        exit /b 1
    )
)

rem --- Node 依存（初回のみ） ---
if not exist "node_modules" (
    echo [setup] npm install を実行しています...
    call npm install
    if errorlevel 1 (
        echo [error] npm install に失敗しました。Node.js がインストールされているか確認してください。
        pause
        exit /b 1
    )
)

rem --- アプリ起動（FastAPI は Electron main が venv の python で起動する） ---
echo [run] アプリを起動します...
call npm run dev

endlocal
