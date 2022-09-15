@echo off

rem ---------------------------------------------------------------------------
rem Set Path to the JRE that is installed together with Collect Earth 
rem ---------------------------------------------------------------------------

echo SET ABSOLUTE REFERENCE TO COLLECT EARTH JRE
rem Sets the location of the Collect Earth provided JRE. This is done in a post-installation action from the installer which replaces C:\OpenForis\CollectEarth/java with the actual path where Collect Earth is installed
set _RUNJAVA="%JAVA_HOME%\bin\java"

exit /b 0
