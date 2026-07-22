@echo off
rem Dev convenience: start Collect Earth forcing a fresh re-import of the demo CEP
rem on every launch (the CEP path argument triggers the double-click import flow,
rem which re-unzips the project and re-applies project_definition.properties).
rem Rebuild the CEP first from the staging folder if you changed the web form:
rem     python collect-earth-app\resources\demo_survey_web\repackage.py
cd /d "%~dp0collect-earth-app"
java -jar target\CollectEarth.jar resources\demo_survey.cep
