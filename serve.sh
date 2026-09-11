#!/bin/sh
set -e
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "Open http://127.0.0.1:${PORT}/ in Chrome or Edge."
echo "Do not open index.html as a file:// URL. Workers and OCR need a local server."
# Bind to loopback only so the page is not reachable from the local network.
python3 -m http.server "$PORT" --bind 127.0.0.1
