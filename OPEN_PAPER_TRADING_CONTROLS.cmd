@echo off
powershell.exe -NoProfile -File "%~dp0scripts\operator\open-public-paper.ps1"
if errorlevel 1 pause
