@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 goto run_py
python -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 goto run_python
echo GhostTrace needs Python 3.10 or newer.
echo Install Python from https://www.python.org/downloads/windows/
echo Enable the Python launcher or add Python to PATH during setup.
echo Then run this file again. No pip packages are required.
pause
exit /b 1
:run_py
py -3 run.py
goto finish
:run_python
python run.py
:finish
pause
