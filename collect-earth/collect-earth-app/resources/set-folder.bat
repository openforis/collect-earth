@echo off 
    setlocal enableextensions disabledelayedexpansion

    ::set "search=%1"
    ::set "replace=%2"

	set "search=FOLDER_SAIKU_INSTALLATION"
    set "replace=%~dp0"
	
	echo REPLACE %replace%
	echo search %search%
	
    set "textFile=.\DB\collectEarthDS_GOALS"
	set "textFileFinal=.\tomcat\webapps\saiku\WEB-INF\classes\saiku-datasources\collectEarthDS"

    for /f "delims=" %%i in ('type "%textFile%" ^& break ^> "%textFileFinal%" ') do (
        set "line=%%i"
        setlocal enabledelayedexpansion
        >>"%textFileFinal%" echo(!line:%search%=%replace%!
        endlocal
    )
	
	echo DONE Replace 1
	:: Fix the problem with the path separators!
	set "search=\"
    set "replace=/"
	
	for /f "delims=" %%i in ('type "%textFileFinal%" ^& break ^> "%textFileFinal%" ') do (
        set "line=%%i"
        setlocal enabledelayedexpansion
        >>"%textFileFinal%" echo(!line:%search%=%replace%!
        endlocal
    )
	echo DONE Replace 2