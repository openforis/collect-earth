@echo off
setlocal

call "%~dp0saiku-server_2.6\set-java.bat"

set CATALINA_HOME=%~dp0saiku-server_2.6\tomcat

set JAVA_HOME=%_JAVA_HOME%
call "%~dp0saiku-server_2.6/tomcat/bin/shutdown.bat"
endlocal
exit
