#!/usr/bin/env bash
# Restore the roadmap from a nightly R2 snapshot.
#
#   scripts/restore-roadmap.sh 2026-09-01
#
# Snapshots are written by the roadmap-kv-backup worker to
# d1-backups/bens-roadmap-kv/<date>.json, alongside the D1 dumps.
set -euo pipefail
DAY="${1:?usage: restore-roadmap.sh <YYYY-MM-DD>}"
DOMAIN="${2:-roadmap.benwhetstone.info}"
TMP="$(mktemp -d)"; JAR="$TMP/jar"; trap 'rm -rf "$TMP"' EXIT

echo "fetching bens-roadmap-kv/$DAY.json"
npx wrangler r2 object get "d1-backups/bens-roadmap-kv/$DAY.json" --file "$TMP/snap.json" --remote >/dev/null 2>&1 \
  || { echo "no snapshot for $DAY"; exit 1; }

python3 - "$TMP/snap.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
items = (d["keys"].get("items") or {}).get("items") or {}
n = sum(len(v) for v in items.values())
print(f"  snapshot from {d['takenAt']}: {n} cards")
if n == 0: sys.exit("refusing to restore an empty board")
PY

printf 'password for brwhetstone@gmail.com: '; read -rs PW; echo
python3 -c "import json,sys;print(json.dumps({'action':'login','email':'brwhetstone@gmail.com','password':sys.argv[1]}))" "$PW" \
  | curl -sS -c "$JAR" -X POST -H "content-type: application/json" -d @- "https://$DOMAIN/api/auth" | grep -q '"ok":true' \
  || { echo "sign-in failed"; exit 1; }

# items goes back as ONE bulk write: the API read-modify-writes KV, so a
# card-at-a-time restore races itself and silently drops entries.
python3 -c "
import json,sys; d=json.load(open(sys.argv[1]))
print(json.dumps({'items': d['keys']['items']['items']}))" "$TMP/snap.json" \
  | curl -sS -b "$JAR" -X POST -H "content-type: application/json" -d @- "https://$DOMAIN/api/items" >/dev/null && echo "  items restored"

python3 -c "
import json,sys; s=json.load(open(sys.argv[1]))['keys']['state']
print(json.dumps({k:s[k] for k in ('done','inProgress','stage','stagesDone') if k in s}))" "$TMP/snap.json" \
  | curl -sS -b "$JAR" -X POST -H "content-type: application/json" -d @- "https://$DOMAIN/api/progress" >/dev/null && echo "  progress restored"

python3 -c "
import json,sys; print(json.dumps({'salaries': json.load(open(sys.argv[1]))['keys']['salaries']['salaries']}))" "$TMP/snap.json" \
  | curl -sS -b "$JAR" -X POST -H "content-type: application/json" -d @- "https://$DOMAIN/api/salaries" >/dev/null && echo "  salaries restored"

echo "done — reload the page to confirm"
