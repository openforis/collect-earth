@echo off
setlocal

echo Navigate to Saiku folder
pushd  "saiku-server_2.6"

echo Set Java variables
call "%~dp0saiku-server_2.6\set-java.bat"
echo Set Folders to replace in the Cube definition
call "%~dp0saiku-server_2.6\set-folder.bat"


set CATALINA_HOME=%~dp0saiku-server_2.6\tomcat

cd saiku-server_2.6\tomcat\bin
echo SETTING CATALINA_HOME %CATALINA_HOME%
set CATALINA_OPTS=-Xms512m -Xmx768m -Dfile.encoding=UTF-8 -Dorg.apache.tomcat.util.buf.UDecoder.ALLOW_ENCODED_SLASH=true -Djava.awt.headless=true
set JAVA_HOME=%_JAVA_HOME%
echo SETTING JAVA_HOME %JAVA_HOME%

echo Terminate Saiku
call "%~dp0saiku-server_2.6\tomcat\bin\shutdown.bat" 
echo Satrt Saiku
call "%~dp0saiku-server_2.6\tomcat\bin\startup.bat"

start "" http://127.0.0.1:8181

:quit
endlocal