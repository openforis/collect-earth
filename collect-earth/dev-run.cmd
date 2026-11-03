@echo off
setlocal
rem Starts the Collect Earth built in collect-earth-app\target, from the folder it must run in
rem (started from target it cannot find its resources), with the plot viewer chosen without the
rem start-up question.
rem
rem   dev-run                     Google Earth Web
rem   dev-run plots_map           the plots map only
rem   dev-run google_earth_pro    Google Earth Pro
set "VIEWER=%~1"
if "%VIEWER%"=="" set "VIEWER=google_earth_web"
set "JAVA=java"
if defined CE_JDK set "JAVA=%CE_JDK%\bin\java"
cd /d "%~dp0collect-earth-app"
if not exist target\CollectEarth.jar (
	echo target\CollectEarth.jar is missing: build it first with dev-build.
	exit /b 1
)
"%JAVA%" -Dcollectearth.viewerType=%VIEWER% -jar target\CollectEarth.jar
