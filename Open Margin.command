#!/bin/zsh
# Double-click to start Margin. Keep this window open while you use it.
# Always uses the same address, because your data is tied to it.
cd "$(dirname "$0")"
PORT=4321
if lsof -i :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  open "http://localhost:$PORT"
  exit 0
fi
(sleep 1; open "http://localhost:$PORT") &
echo "Margin is running at http://localhost:$PORT — close this window to stop it."
python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1
