@echo off
rem private-talk offline updater: drag the new package onto this file, or
rem   update.cmd <package>   update.cmd --rollback   update.cmd --import <old folder>
rem Node runs from a temporary copy so that node\ can be replaced.
cd /d "%~dp0"
chcp 65001 >nul
rem One command per line: inside ( ) blocks cmd expands %PT_NODE% too early.
set "PT_NODE=node"
if exist "node\node.exe" set "PT_NODE=%TEMP%\private-talk-update-%RANDOM%%RANDOM%.exe"
if not "%PT_NODE%"=="node" copy /y "node\node.exe" "%PT_NODE%" >nul
"%PT_NODE%" app\server\update.mjs %*
set "PT_RC=%ERRORLEVEL%"
if not "%PT_NODE%"=="node" del "%PT_NODE%" >nul 2>&1
if not defined PT_NO_PAUSE pause
exit /b %PT_RC%
