#!/usr/bin/env bash
# Daily update: re-harvest sources, rebuild the Hebrew dashboard, commit & push if changed.
# Deterministic core of the daily agent — safe to run unattended. Discovery of NEW
# sources (adding rows to seeds.json) is done by the scheduled agent before calling this.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "[daily-update] $(date '+%Y-%m-%d %H:%M') — repo: $REPO"

git pull --quiet --rebase origin main || echo "[warn] git pull failed; continuing on local state"

# Re-fetch metadata (picks up newly published dates / fixes transient 4xx) and rebuild.
node harvester/harvest.mjs --delay 2800
node harvester/build-dashboard.mjs

if git diff --quiet -- data/manifest.json docs/07-reported-record.md index.html; then
  echo "[daily-update] no changes — nothing to commit"
  exit 0
fi

git add -A
git -c commit.gpgsign=false commit -q \
  -m "chore(daily): refresh corpus + dashboard ($(date '+%Y-%m-%d'))" \
  --author="SaharBarak <sahar.h.barak@gmail.com>"
git push --quiet origin main
echo "[daily-update] pushed refresh"
