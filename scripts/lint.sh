#!/usr/bin/env bash
# scripts/lint.sh - Run the lint gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/lint.sh, scripts/typescript/lint.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/lint.sh"
    [[ -x "$target" ]] || continue
    echo "=== lint: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
