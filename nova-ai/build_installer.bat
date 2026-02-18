@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   Nova AI Lite - 인스톨러 빌드 스크립트
echo ============================================
echo.

:: ──────────────────────────────────────────────
:: 1단계: 기존 빌드 정리
:: ──────────────────────────────────────────────
echo [1/3] 기존 빌드 파일 정리 중...
if exist "dist\Nova AI Lite" (
    rmdir /s /q "dist\Nova AI Lite"
    echo   - dist\Nova AI Lite 폴더 삭제 완료
)
if exist "build\Nova AI Lite" (
    rmdir /s /q "build\Nova AI Lite"
    echo   - build\Nova AI Lite 폴더 삭제 완료
)
echo.

:: ──────────────────────────────────────────────
:: 2단계: PyInstaller로 EXE 빌드
:: ──────────────────────────────────────────────
echo [2/3] PyInstaller로 앱 빌드 중...
echo   (시간이 다소 걸릴 수 있습니다)
echo.

pyinstaller "Nova AI Lite_installer.spec" --noconfirm
if errorlevel 1 (
    echo.
    echo ❌ PyInstaller 빌드 실패!
    echo   pyinstaller가 설치되어 있는지 확인하세요: pip install pyinstaller
    pause
    exit /b 1
)

:: 빌드 결과 확인
if not exist "dist\Nova AI Lite\Nova AI Lite.exe" (
    echo.
    echo ❌ 빌드된 EXE 파일을 찾을 수 없습니다!
    pause
    exit /b 1
)
echo.
echo   ✅ PyInstaller 빌드 성공!
echo.

:: ──────────────────────────────────────────────
:: 3단계: Inno Setup으로 인스톨러 생성
:: ──────────────────────────────────────────────
echo [3/3] Inno Setup으로 인스톨러 생성 중...

:: output 폴더 생성
if not exist "output" mkdir output

:: Inno Setup 경로 탐색
set "ISCC="

:: 일반적인 설치 경로들
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
)

:: PATH에서 찾기
if "!ISCC!"=="" (
    where iscc >nul 2>&1
    if not errorlevel 1 (
        set "ISCC=iscc"
    )
)

if "!ISCC!"=="" (
    echo.
    echo ⚠️  Inno Setup을 찾을 수 없습니다!
    echo.
    echo   PyInstaller 빌드는 완료되었습니다:
    echo     dist\Nova AI Lite\Nova AI Lite.exe
    echo.
    echo   인스톨러를 만들려면 Inno Setup 6을 설치하세요:
    echo     https://jrsoftware.org/isdl.php
    echo.
    echo   설치 후 이 스크립트를 다시 실행하거나,
    echo   Inno Setup Compiler에서 installer.iss를 직접 열어 컴파일하세요.
    echo.
    pause
    exit /b 0
)

"!ISCC!" installer.iss
if errorlevel 1 (
    echo.
    echo ❌ Inno Setup 컴파일 실패!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   ✅ 인스톨러 빌드 완료!
echo ============================================
echo.
echo   인스톨러 위치:
echo     output\NovaAILite_Setup_1.0.0.exe
echo.
echo   배포 시 이 파일을 사용자에게 전달하세요.
echo ============================================
echo.
pause
