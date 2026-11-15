#!/bin/sh
# Double-click to run web-pak locally: it serves the built app/ folder on http://localhost:5194
# and opens it. Browsers only run its WebAssembly engine from a web address, not from file://.
cd "$(dirname "$0")/app" || exit 1
PORT=5194
( sleep 1; open "http://localhost:$PORT/" 2>/dev/null || xdg-open "http://localhost:$PORT/" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
