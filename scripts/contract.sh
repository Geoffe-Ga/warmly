#!/usr/bin/env bash
# scripts/contract.sh - Run the API contract gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/contract.sh, scripts/typescript/contract.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/contract.sh"
    [[ -x "$target" ]] || continue
    echo "=== contract: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
