set _LAUNCHER=java.exe

:gotJava
goto findJavaInFolder

:findJavaInFolder
if exist "%~dp0java" (
  echo Using %~dp0java\
  set _JAVA_HOME=%~dp0java
  set _JAVA=%~dp0java\bin\%_LAUNCHER%
  goto end
) else (
   if exist "%~dp0..\java" (
     echo Using %~dp0..\java
     set _JAVA_HOME=%~dp0..\java
     set _JAVA=%~dp0..\java\bin\%_LAUNCHER%
	 goto end
   ) else (
     goto checkJavaHome
   )
)

:checkJavaHome
if not "%JAVA_HOME%" == "" goto gotJdkHome
if not "%COLLECT_EARTH_JRE_HOME%" == "" goto gotCollectEarthJreHome
if not "%JRE_HOME%" == "" goto gotJreHome
goto end

:gotJdkHome
echo DEBUG: Using JAVA_HOME
set _JAVA_HOME=%JAVA_HOME%
set _JAVA=%JAVA_HOME%\bin\%_LAUNCHER%
goto end

:gotCollectEarthJreHome
echo DEBUG: Using COLLECT_EARTH_JRE_HOME
set _JAVA_HOME=%COLLECT_EARTH_JRE_HOME%
set _JAVA=%COLLECT_EARTH_JRE_HOME%\bin\%_LAUNCHER%
goto end

:gotJreHome
echo DEBUG: Using JRE_HOME
set _JAVA_HOME=%JRE_HOME%
set _JAVA=%JRE_HOME%\bin\%_LAUNCHER%
goto end


goto end

:end

echo DEBUG: JAVA EXECUTABLE=%_JAVA%