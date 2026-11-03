@echo off
rem Finds a JDK for the other dev-*.cmd scripts and puts it first on the PATH (Maven needs javac and
rem javadoc, which a JRE does not have). Set CE_JDK once to choose one, e.g.:
rem     setx CE_JDK C:\opt\jdk-23.0.1
rem otherwise JAVA_HOME is used if it is a JDK.
if defined CE_JDK (
	set "JAVA_HOME=%CE_JDK%"
)
if not exist "%JAVA_HOME%\bin\javac.exe" (
	echo No JDK found: JAVA_HOME is "%JAVA_HOME%", which has no bin\javac.exe.
	echo Set CE_JDK to a JDK folder, for example:  setx CE_JDK C:\opt\jdk-23.0.1
	exit /b 1
)
set "PATH=%JAVA_HOME%\bin;%PATH%"
exit /b 0
