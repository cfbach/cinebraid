@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found - install from https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo First run - installing dependencies... & call npm install --silent)
start "" http://localhost:4477
node server.js
pause
