@echo off
REM ===========================================================================
REM  OmniGuard AI - one-click launcher
REM
REM  Double-click this file. It sets everything up the first time and just
REM  starts the app on every run after that.
REM
REM  NOTE: delayed expansion is deliberately NOT enabled - this project's
REM  folder name contains "!", which delayed expansion would eat.
REM ===========================================================================

title OmniGuard AI
cd /d "%~dp0"

REM The C: drive on this machine is full, so keep every temp file on D:.
set "TEMP=%~dp0.tmp"
set "TMP=%~dp0.tmp"
set "PIP_CACHE_DIR=%~dp0.pipcache"
if not exist ".tmp" mkdir ".tmp"

echo.
echo  ============================================================
echo    OmniGuard AI  -  Deepfake Detection
echo  ============================================================
echo.

REM --------------------------------------------------------------- python ---
where python >nul 2>&1
if errorlevel 1 (
    echo  [X] Python is not installed or not on PATH.
    echo      Install Python 3.10+ from https://python.org
    echo      During install, tick "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

REM ------------------------------------------------------------ environment ---
if not exist ".venv\Scripts\python.exe" (
    echo  [1/4] Creating the Python environment ^(one time, ~1 min^)...
    python -m venv .venv
    if errorlevel 1 (
        echo  [X] Could not create the virtual environment.
        pause
        exit /b 1
    )
) else (
    echo  [1/4] Python environment found.
)

.venv\Scripts\python.exe -c "import fastapi, onnxruntime, cv2" >nul 2>&1
if errorlevel 1 (
    echo  [2/4] Installing dependencies ^(one time, ~3 min^)...
    .venv\Scripts\python.exe -m pip install --quiet --upgrade pip
    .venv\Scripts\python.exe -m pip install --quiet -r requirements.txt
    if errorlevel 1 (
        echo  [X] Dependency installation failed. Scroll up for the reason.
        pause
        exit /b 1
    )
) else (
    echo  [2/4] Dependencies present.
)

REM ----------------------------------------------------------- face models ---
if not exist "backend\models\face_detection_yunet.onnx" (
    echo  [3/4] Downloading the face detection model...
    curl -sL -o "backend\models\face_detection_yunet.onnx" "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
if not exist "backend\models\face_recognition_sface.onnx" (
    echo        Downloading the face recognition model...
    curl -sL -o "backend\models\face_recognition_sface.onnx" "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
)
echo  [3/4] Face models ready.

REM -------------------------------------------------------------- frontend ---
if not exist "frontend\dist\index.html" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo  [!] npm not found - the dashboard cannot be built.
        echo      The API will still run at http://127.0.0.1:8000/docs
    ) else (
        echo  [4/4] Building the dashboard ^(one time, ~2 min^)...
        pushd frontend
        call npm install --no-audit --no-fund --silent
        call npm run build --silent
        popd
    )
) else (
    echo  [4/4] Dashboard already built.
)

REM ------------------------------------------------------------ model check ---
.venv\Scripts\python.exe -c "import pathlib,sys; d=pathlib.Path('backend/models'); ex={'face_detection_yunet.onnx','face_recognition_sface.onnx'}; sys.exit(0 if [p for p in d.glob('*.onnx') if p.name not in ex] else 1)" >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ------------------------------------------------------------
    echo   WARNING: no trained deepfake models found.
    echo.
    echo   Detection will not work until you:
    echo     1. Run notebooks\OmniGuard_Training.ipynb on Google Colab
    echo     2. Unzip omniguard_models.zip into backend\models\
    echo     3. Run this file again
    echo.
    echo   The app will still start so you can look around.
    echo  ------------------------------------------------------------
)

echo.
echo  Starting server...
echo  Opening http://127.0.0.1:8000 in your browser.
echo.
echo  Leave this window open. Press Ctrl+C here to stop.
echo.

start "" http://127.0.0.1:8000
.venv\Scripts\python.exe backend\main.py

echo.
echo  Server stopped.
pause
