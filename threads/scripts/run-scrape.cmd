@echo off
cd /d "%~dp0\.."
if not exist "logs" mkdir logs
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m socnetscraper scrape >> "logs\task.log" 2>&1
) else (
  python -m socnetscraper scrape >> "logs\task.log" 2>&1
)
