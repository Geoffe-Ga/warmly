#!/usr/bin/env bash
# scripts/check-all.sh - Run the check-all gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/check-all.sh, scripts/typescript/check-all.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/check-all.sh"
    [[ -x "$target" ]] || continue
    echo "=== check-all: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
