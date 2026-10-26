@echo off
rem StepFun Code-GUI one-click launcher (Windows).
rem Double-click this file; it only requires Node.js 22+ on PATH.
chcp 65001 >nul
setlocal
where node >nul 2>nul
if errorlevel 1 (
	echo [step-orchestra] 未找到 Node.js。请先安装 Node.js 22+ : https://nodejs.org/
	echo [step-orchestra] Node.js not found - install Node.js 22+ from https://nodejs.org/
	pause
	exit /b 1
)
node "%~dp0start.mjs" %*
if errorlevel 1 pause
endlocal
