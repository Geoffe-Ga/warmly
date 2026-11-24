#!/usr/bin/env bash
# scripts/security.sh - Run the security gate for every language in this repo.
# Python (FastAPI backend) runs first, then TypeScript (PWA frontend).
# Arguments are passed through to each language-specific script.
# Language-specific variants: scripts/python/security.sh, scripts/typescript/security.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
for lang in python typescript; do
    target="$SCRIPT_DIR/$lang/security.sh"
    [[ -x "$target" ]] || continue
    echo "=== security: $lang ==="
    "$target" "$@" || status=1
done
exit "$status"
