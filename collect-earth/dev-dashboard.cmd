@echo off
setlocal
rem Builds the local dashboard (docs/plans/2026-11-03-desktop-dashboard.md) from ..\..\collect-earth-cloud and
rem puts it in collect-earth-app\target\dashboard, where a Collect Earth started with dev-run finds it. The
rem development builds never build it (only -P release and -P assembly do): run this once, and again after the
rem cloud's code changes or after dev-build clean. Restart Collect Earth afterwards: it looks for the dashboard
rem when it starts.
rem
rem It uses the Node of the web UI (collect-earth-app\src\main\frontend\node, the one the dashboard runs with),
rem and installs the packages with npm install --prefer-offline, as the local builds of the web UI do. It needs
rem registry.npmjs.org the first time.
set "CLOUD=%~dp0..\collect-earth-cloud"
set "APP=%~dp0collect-earth-app"
set "NODE_DIR=%APP%\src\main\frontend\node"
set "TARGET=%APP%\target\dashboard"
if not exist "%CLOUD%\package.json" (
	echo collect-earth-cloud is not at %CLOUD%: the dashboard is built from there.
	exit /b 1
)
if not exist "%NODE_DIR%\node.exe" (
	echo No Node in %NODE_DIR%: build Collect Earth once with dev-build, which installs it.
	exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"

echo Building the dashboard's server in %CLOUD%
cd /d "%CLOUD%"
call npm install --prefer-offline --no-audit --no-fund || exit /b 1
call npm run build:local || exit /b 1

echo Building the dashboard's web app in %CLOUD%\web
cd /d "%CLOUD%\web"
call npm install --prefer-offline --no-audit --no-fund || exit /b 1
call npx vite build || exit /b 1

rem Emptied first, as clean-dashboard does: the web app's assets have a new name at each build
if exist "%TARGET%" rmdir /s /q "%TARGET%"
if exist "%TARGET%" (
	echo %TARGET% could not be emptied: a running dashboard keeps its files open. Close Collect Earth first.
	exit /b 1
)
rem robocopy answers 0 to 7 when it worked; the .gz copies are for the cloud's slow links only
robocopy "%CLOUD%\dist" "%TARGET%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 exit /b 1
robocopy "%CLOUD%\web\dist" "%TARGET%\web" /E /XF *.gz /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 exit /b 1
for %%F in (server.mjs qualityWorker.mjs web\index.html) do (
	if not exist "%TARGET%\%%F" (
		echo The build left no %%F in %TARGET%.
		exit /b 1
	)
)
echo The dashboard is in %TARGET%. Restart Collect Earth ^(dev-run^) to start it.
exit /b 0
