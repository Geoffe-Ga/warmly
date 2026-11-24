#!/usr/bin/env bash
# scripts/complexity.sh - Run the complexity gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/complexity.sh, scripts/typescript/complexity.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/complexity.sh"
    [[ -x "$target" ]] || continue
    echo "=== complexity: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
