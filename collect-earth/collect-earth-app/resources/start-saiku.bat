@echo off
setlocal

call "%~dp0\set-java.bat"


cd tomcat\bin
set CATALINA_HOME=%~dp0tomcat
set CATALINA_OPTS=-Xms512m -Xmx768m -Dfile.encoding=UTF-8 -Dorg.apache.tomcat.util.buf.UDecoder.ALLOW_ENCODED_SLASH=true -Djava.awt.headless=true
:: set JAVA_HOME=%_JAVA_HOME%
call startup
:quit
endlocal
