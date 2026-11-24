#!/usr/bin/env bash
# scripts/coverage.sh - Run the coverage gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/coverage.sh, scripts/typescript/coverage.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/coverage.sh"
    [[ -x "$target" ]] || continue
    echo "=== coverage: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
