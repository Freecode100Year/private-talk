@echo off
rem private-talk, LAN / intranet mode. Close this window to stop it.
cd /d "%~dp0"
chcp 65001 >nul
"%~dp0node\node.exe" server\lan.mjs
pause
