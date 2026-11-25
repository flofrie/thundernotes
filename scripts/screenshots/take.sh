#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Takes the screenshots in docs/screenshots/ from the add-on's built pages, in headless Chrome,
# with a stand-in for Thunderbird's API and invented sample notes (mock.js, email.html).
#   scripts/screenshots/take.sh            all shots
#   scripts/screenshots/take.sh tasks      only some (email notes options tasks tetris)
# Needs Google Chrome and python3. Builds the add-on first.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
TB="$ROOT/packages/thunderbird"
OUT="$ROOT/docs/screenshots"
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PORT=${PORT:-8765}
SHOTS=${*:-"email notes options tasks tetris"}

npm run build -w @thundernotes/thunderbird >/dev/null 2>&1 || { echo "build failed: run npm run build -w @thundernotes/thunderbird" >&2; exit 1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/thundernotes-shots.XXXXXX")
SERVER=
cleanup() { [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

SITE="$WORK/site"
mkdir -p "$SITE" "$OUT"
cp -R "$TB/dist" "$TB/icons" "$TB/content.css" "$SITE/"
cp "$HERE/clock.js" "$HERE/mock.js" "$HERE/autoplay.js" "$HERE/email.html" "$SITE/"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TB/manifest.json" | head -1)

# The pages load mock.js first, which then loads the page's own script.
for page in notes options tasks tetris; do
  sed "s#<script src=\"dist/$page.js\"></script>#<script>window.__page='dist/$page.js'; window.__version='$VERSION'</script><script src=\"clock.js\"></script><script src=\"mock.js\"></script>#" \
    "$TB/$page.html" > "$SITE/$page.html"
  grep -q mock.js "$SITE/$page.html" || { echo "$page.html: script tag not found" >&2; exit 1; }
done
# Tetris plays a few pieces when opened with ?auto.
sed -i '' 's#<script src="mock.js"></script>#&<script>if (location.search.includes("auto")) setTimeout(() => { const s = document.createElement("script"); s.src = "autoplay.js"; document.body.append(s); }, 300);</script>#' "$SITE/tetris.html"

# The email's notes are rendered by core's renderMarkdown, as the background does in Thunderbird.
"$ROOT/node_modules/.bin/esbuild" "$HERE/render-entry.ts" --bundle --format=iife --log-level=warning \
  --alias:@thundernotes/core="$ROOT/packages/core/src/index.ts" --outfile="$SITE/render.js"

(cd "$SITE" && exec python3 -I -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER=$!
sleep 1

shot() { # name, url path, width, height, virtual time in ms
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size="$3,$4" \
    --virtual-time-budget="$5" --enable-unsafe-swiftshader --use-angle=swiftshader \
    --user-data-dir="$WORK/profile-$1" --screenshot="$OUT/$1.png" "http://127.0.0.1:$PORT/$2" >/dev/null 2>&1
  echo "docs/screenshots/$1.png"
}

for s in $SHOTS; do
  case $s in
    email)   shot email email.html 1400 620 4000 ;;
    notes)   shot notes notes.html 1600 1000 4000 ;;
    options) shot options options.html 1600 1000 4000 ;;
    tasks)   shot tasks tasks.html 1600 1000 4000 ;;
    tetris)  shot tetris "tetris.html?auto" 1600 1000 6000 ;;
    *) echo "unknown shot: $s" >&2; exit 1 ;;
  esac
done
