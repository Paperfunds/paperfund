@echo off
cd /d "%~dp0"
if /I "%~1"=="-Mixed" goto mixed
powershell.exe -NoProfile -File "%~dp0scripts\operator\launcher.ps1" %*
goto result
:mixed
rem Explicit opt-in only. The ordinary, pinned launcher is preserved.
%SystemRoot%\System32\certutil.exe -hashfile "%~dp0scripts\operator\start-mixed-reviewed.ps1" SHA256 | %SystemRoot%\System32\findstr.exe /I /X /C:"b1c9cce4fd65b7373902a9afd5f3ebfae53c49458de09274acc719fb396ca982" >nul
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -File "%~dp0scripts\operator\start-mixed-reviewed.ps1" %*
:result
set "PAPERFUND_EXIT=%ERRORLEVEL%"
if not "%PAPERFUND_EXIT%"=="0" pause
exit /b %PAPERFUND_EXIT%
