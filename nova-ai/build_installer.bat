@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

pushd "%~dp0"

set "APP_VERSION=2.1.1"
set "DIST_DIR=dist\Nova AI"
set "DIST_EXE=dist\Nova AI\Nova AI.exe"
set "PORTABLE_DIR=output\Nova AI-portable"
set "SETUP_EXE=output\NovaAI_Setup_%APP_VERSION%.exe"
set "RELEASE_ENV=release\.env.runtime"
set "SPEC_FILE=NovaAI.spec"
set "PYTHON_EXE=python"
if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"

echo ============================================
echo   Nova AI installer build
echo ============================================
echo.

echo [1/4] Cleaning previous build outputs...
if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
if exist "build\Nova AI" rmdir /s /q "build\Nova AI"
if exist "build\NovaAI" rmdir /s /q "build\NovaAI"
if exist "%PORTABLE_DIR%" rmdir /s /q "%PORTABLE_DIR%"
if exist "%SETUP_EXE%" del /f /q "%SETUP_EXE%"
echo.

echo [2/4] Preparing release runtime config...
if not exist "%SPEC_FILE%" goto :spec_missing
"%PYTHON_EXE%" "prepare_release_runtime.py"
if errorlevel 1 goto :release_config_failed
if not exist "%RELEASE_ENV%" goto :release_env_missing
echo.

echo [3/4] Building PyInstaller bundle...
"%PYTHON_EXE%" -m PyInstaller "%SPEC_FILE%" --noconfirm
if errorlevel 1 goto :pyinstaller_failed
if not exist "%DIST_EXE%" goto :dist_missing

copy /Y "%RELEASE_ENV%" "%DIST_DIR%\.env.runtime" >nul
if errorlevel 1 goto :dist_env_copy_failed

if not exist "output" mkdir output
robocopy "%DIST_DIR%" "%PORTABLE_DIR%" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :portable_copy_failed
echo Portable folder ready: %PORTABLE_DIR%
echo.

echo [4/4] Building setup exe with Inno Setup...
set "ISCC="
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if "!ISCC!"=="" (
    where iscc >nul 2>&1
    if not errorlevel 1 set "ISCC=iscc"
)
if "!ISCC!"=="" goto :inno_missing

"!ISCC!" installer.iss
if errorlevel 1 goto :inno_failed
if not exist "%SETUP_EXE%" goto :setup_missing

echo.
echo ============================================
echo   Build completed successfully
echo ============================================
echo Setup exe : %SETUP_EXE%
echo Portable  : %PORTABLE_DIR%
echo.
pause
popd
exit /b 0

:spec_missing
echo.
echo ERROR: PyInstaller spec file was not found: %SPEC_FILE%
goto :fail

:release_config_failed
echo.
echo ERROR: failed to prepare release runtime config.
echo Check .env and required keys:
echo   GEMINI_API_KEY
echo   NEXT_PUBLIC_FIREBASE_API_KEY
echo   NEXT_PUBLIC_FIREBASE_PROJECT_ID
goto :fail

:release_env_missing
echo.
echo ERROR: release runtime config was not created: %RELEASE_ENV%
goto :fail

:pyinstaller_failed
echo.
echo ERROR: PyInstaller build failed.
echo Install PyInstaller if needed: pip install pyinstaller
goto :fail

:dist_missing
echo.
echo ERROR: built executable not found: %DIST_EXE%
goto :fail

:dist_env_copy_failed
echo.
echo ERROR: failed to copy .env.runtime into dist folder.
goto :fail

:portable_copy_failed
echo.
echo ERROR: failed to prepare portable output folder.
goto :fail

:inno_missing
echo.
echo ERROR: Inno Setup 6 was not found.
echo Portable output is still available at:
echo   %PORTABLE_DIR%
echo Install Inno Setup 6: https://jrsoftware.org/isdl.php
goto :fail

:inno_failed
echo.
echo ERROR: Inno Setup compilation failed.
goto :fail

:setup_missing
echo.
echo ERROR: setup exe was not created: %SETUP_EXE%
goto :fail

:fail
echo.
pause
popd
exit /b 1
