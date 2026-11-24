#!/usr/bin/env bash
# scripts/e2e.sh - Run the e2e gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/e2e.sh, scripts/typescript/e2e.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/e2e.sh"
    [[ -x "$target" ]] || continue
    echo "=== e2e: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
