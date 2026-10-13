@echo off
rem private-talk: version, settings, certificates, and whether it is running.
cd /d "%~dp0"
chcp 65001 >nul
if exist "node\node.exe" ("node\node.exe" app\server\status.mjs) else (node app\server\status.mjs)
if not defined PT_NO_PAUSE pause
