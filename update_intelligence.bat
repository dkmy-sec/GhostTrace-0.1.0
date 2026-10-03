@echo off
setlocal
cd /d "%~dp0"
echo Close the running GhostTrace collector before updating.
echo This downloads public tracker, registry, country, and ASN datasets.
echo It does not upload any browsing records.
py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>&1
if errorlevel 1 goto use_python
py -3 tools\update_data.py
goto finish
:use_python
python tools\update_data.py
:finish
if errorlevel 1 echo Update failed. Read the message above; your existing files are preserved for any failed download.
pause
