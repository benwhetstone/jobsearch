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

npx wrangler pages deploy "$DIR" --project-name="$PROJECT" --branch=main 2>&1 \
  | grep -iE "Uploaded|Deployment complete" || true

printf 'confirming live'
for i in $(seq 1 40); do
  LIVE="$(curl -s "https://$DOMAIN/?cb=$RANDOM$i" | grep -o 'name="build" content="[^"]*"' | head -1 | cut -d'"' -f4 || true)"
  if [ "$LIVE" = "$BUILD" ]; then echo; echo "CONFIRMED LIVE: $BUILD  (after ${i} checks)"; exit 0; fi
  printf '.'; sleep 6
done
echo; echo "NOT CONFIRMED after 40 checks — live reports '${LIVE:-none}', expected '$BUILD'"
exit 1
