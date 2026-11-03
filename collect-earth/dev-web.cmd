@echo off
setlocal
rem Live editing of the web UI (plots map and web form), with no Maven build and no restart:
rem start Collect Earth (dev-run), then this, and open
rem     http://localhost:5173/map.html
rem The page reloads by itself on every saved change in collect-earth-app\src\main\frontend, and
rem talks to the running Collect Earth (port 8028). Stop with Ctrl+C. The jar keeps the web UI of
rem its last build until the next dev-build.
cd /d "%~dp0collect-earth-app\src\main\frontend"
set "NPM=npm"
if exist node\npm.cmd (
	set "PATH=%CD%\node;%PATH%"
	set "NPM=node\npm.cmd"
)
call %NPM% install --prefer-offline --no-audit --no-fund || exit /b 1
call %NPM% run dev
