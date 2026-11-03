@echo off
setlocal
rem Fast developer build of Collect Earth: only collect-earth-app and the modules it needs (core and
rem sampler), without clean, tests or javadoc, reusing the web UI's installed packages.
rem
rem   dev-build              Java and the web UI (plots map and web form)
rem   dev-build java         Java only: keeps the web UI built last time (-Dskip.npm)
rem   dev-build clean        clean first: after deleting or renaming source files, or switching branch
rem   dev-build clean java   both
rem
rem The complete build of every module with its tests is still:  mvn clean install
rem Close Collect Earth first: while it runs, Windows locks its jar and libraries in target.
call "%~dp0dev-jdk.cmd" || exit /b 1
set "GOALS=install"
set "SKIP_NPM="
:args
if "%~1"=="" goto run
if /i "%~1"=="clean" set "GOALS=clean install"
if /i "%~1"=="java" set "SKIP_NPM=-Dskip.npm"
shift
goto args
:run
netstat -ano | findstr /r /c:":8028 .*LISTENING" >nul
if not errorlevel 1 (
	echo Collect Earth is running ^(port 8028^): close it first, its jar and libraries are locked while it runs.
	exit /b 1
)
cd /d "%~dp0"
echo mvn -q %GOALS% -pl collect-earth-app -am -DskipTests -Dmaven.javadoc.skip=true %SKIP_NPM%
call mvn -q %GOALS% -pl collect-earth-app -am -DskipTests -Dmaven.javadoc.skip=true %SKIP_NPM%
if errorlevel 1 exit /b 1
echo Built collect-earth-app\target\CollectEarth.jar. Start it with dev-run.
