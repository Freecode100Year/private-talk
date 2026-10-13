@echo off
rem private-talk, LAN / intranet mode. Close this window to stop it.
rem Settings go in config.env (see config.env.example), not in this file.
cd /d "%~dp0"
chcp 65001 >nul
if exist "node\node.exe" ("node\node.exe" app\server\lan.mjs) else (node app\server\lan.mjs)
pause
