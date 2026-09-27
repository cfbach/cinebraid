@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found - install from https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo First run - installing locked dependencies...
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Check the error above, then try again.
    pause
    exit /b 1
  )
)
echo Open the local URL printed by CineBraid below in your browser.
node server.js
set "CINEBRAID_EXIT_CODE=%ERRORLEVEL%"
pause
exit /b %CINEBRAID_EXIT_CODE%
