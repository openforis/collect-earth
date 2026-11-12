@echo off
setlocal
rem Starts the Collect Earth built in collect-earth-app\target, from the folder it must run in
rem (started from target it cannot find its resources).
rem The JVM keeps the classes it loaded in target\CollectEarth.jsa (class-data sharing, JDK 19 and
rem later; older ones ignore it) and maps them on the next starts; a rebuilt jar remakes it.
set "JAVA=java"
if defined CE_JDK set "JAVA=%CE_JDK%\bin\java"
cd /d "%~dp0collect-earth-app"
if not exist target\CollectEarth.jar (
	echo target\CollectEarth.jar is missing: build it first with dev-build.
	exit /b 1
)
"%JAVA%" -XX:+IgnoreUnrecognizedVMOptions -XX:+AutoCreateSharedArchive -XX:SharedArchiveFile=target\CollectEarth.jsa -jar target\CollectEarth.jar
