#!/usr/bin/env bash
# Deploy a Pages site and PROVE the new build is the one being served.
#
# Every deploy stamps a unique build id into index.html, then this polls the
# live domain (cache-busted) until that exact id comes back. No more reading a
# stale page and drawing conclusions from it: if it does not confirm, it fails.
#
#   scripts/deploy-pages.sh roadmap/public bens-roadmap roadmap.benwhetstone.info
set -euo pipefail

DIR="${1:?usage: deploy-pages.sh <dir> <project> <domain>}"
PROJECT="${2:?}"
DOMAIN="${3:?}"
INDEX="$DIR/index.html"
[ -f "$INDEX" ] || { echo "no index.html in $DIR"; exit 1; }

BUILD="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"

# replace an existing stamp, or insert one right after <head>-ish start
if grep -q 'name="build"' "$INDEX"; then
  perl -0pi -e "s{<meta name=\"build\" content=\"[^\"]*\">}{<meta name=\"build\" content=\"$BUILD\">}" "$INDEX"
else
  perl -0pi -e "s{(<meta charset=[^>]*>)}{\$1\n  <meta name=\"build\" content=\"$BUILD\">}i" "$INDEX"
fi
grep -q "$BUILD" "$INDEX" || { echo "could not stamp build id"; exit 1; }
echo "build $BUILD"

# Pages picks up functions/ RELATIVE TO THE WORKING DIRECTORY, not to the asset
# dir. Deploying from the repo root silently shipped roadmap/public without
# roadmap/functions and took the whole API offline. So always run from the
# project root (the parent of the asset dir) and pass a relative path.
ROOT="$(cd "$(dirname "$DIR")" && pwd)"
ASSETS="$(basename "$DIR")"
if [ -d "$ROOT/functions" ]; then echo "functions/ found — API will ship"; fi
( cd "$ROOT" && npx wrangler pages deploy "$ASSETS" --project-name="$PROJECT" --branch=main 2>&1 \
  | grep -iE "Uploaded|Deployment complete" ) || true

printf 'confirming live'
for i in $(seq 1 40); do
  LIVE="$(curl -s "https://$DOMAIN/?cb=$RANDOM$i" | grep -o 'name="build" content="[^"]*"' | head -1 | cut -d'"' -f4 || true)"
  if [ "$LIVE" = "$BUILD" ]; then
    echo; echo "CONFIRMED LIVE: $BUILD  (after ${i} checks)"
    # a page without its API is a broken deploy, so prove the functions answer too
    if [ -d "$ROOT/functions" ]; then
      # files starting with _ are shared modules, not routes
      for ep in $(ls "$ROOT/functions/api" 2>/dev/null | grep -v '^_' | sed 's/\.ts$//'); do
        CT="$(curl -s -o /dev/null -w '%{content_type}' "https://$DOMAIN/api/$ep")"
        case "$CT" in application/json*) echo "  API /api/$ep OK";;
          *) echo "  API /api/$ep BROKEN — returned '$CT', expected JSON"; exit 1;; esac
      done
    fi
    exit 0
  fi
  printf '.'; sleep 6
done
echo; echo "NOT CONFIRMED after 40 checks — live reports '${LIVE:-none}', expected '$BUILD'"
exit 1
