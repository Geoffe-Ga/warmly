#!/usr/bin/env bash
# scripts/fix-all.sh - Run the fix-all gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/fix-all.sh, scripts/typescript/fix-all.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/fix-all.sh"
    [[ -x "$target" ]] || continue
    echo "=== fix-all: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
