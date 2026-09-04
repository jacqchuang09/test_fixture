@echo off
REM ============================================================
REM  One-shot Windows build + launch for the Zaber GUI app.
REM  Requirements: Python 3.10-3.12 (64-bit) installed and on PATH.
REM  Just double-click this file.
REM ============================================================
setlocal
cd /d "%~dp0"

echo === [1/4] Creating virtual environment (.venv) ===
python -m venv .venv || goto :err
call .venv\Scripts\activate.bat || goto :err

echo === [2/4] Upgrading pip ===
python -m pip install --upgrade pip

echo === [3/4] Installing dependencies (first run downloads ~hundreds of MB) ===
pip install -r requirements.txt || goto :err

echo === [4/4] Building ZaberGUI.exe ===
pyinstaller app_desktop.spec --noconfirm || goto :err

echo.
echo ============================================================
echo  BUILD COMPLETE.  Launching the app...
echo  (The exe lives at: dist\ZaberGUI\ZaberGUI.exe)
echo ============================================================
start "" "dist\ZaberGUI\ZaberGUI.exe"
goto :eof

:err
echo.
echo ************************************************************
echo  BUILD FAILED.
echo  - Make sure Python 3.10-3.12 (64-bit) is installed and on PATH
echo    (run:  python --version  to check).
echo  - If the app window is blank, install the
echo    "Microsoft Edge WebView2 Runtime" from Microsoft.
echo ************************************************************
pause
