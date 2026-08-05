#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js not found — install from https://nodejs.org (18+)"; read -r -p "Press Enter to close…"; exit 1; }
[ -d node_modules ] || { echo "First run — installing dependencies…"; npm install --silent; }
( sleep 1.5; command -v xdg-open >/dev/null && xdg-open http://localhost:4477 || open http://localhost:4477 ) &
node server.js
