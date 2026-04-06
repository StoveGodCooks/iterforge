@echo off
setlocal
title InterForge Release Builder
color 0B
cd /d "%~dp0"

echo.
echo  =====================================================
echo   InterForge  --  Release Builder
echo   This creates a real .exe installer you can share.
echo  =====================================================
echo.
echo  Building... this takes 2-5 minutes on first run.
echo.

npm run tauri build

if %errorlevel%==0 (
    echo.
    echo  =====================================================
    echo   Build complete!
    echo   Installer:  src-tauri\target\release\bundle\nsis\
    echo   Portable:   src-tauri\target\release\interforge.exe
    echo  =====================================================
    start "" "src-tauri\target\release\bundle"
) else (
    echo.
    echo  [ERROR] Build failed. Check the output above.
    pause
)
