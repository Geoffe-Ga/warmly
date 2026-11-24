#!/usr/bin/env bash
# scripts/python/contract.sh - Export the OpenAPI contract from the FastAPI app
# Usage: ./scripts/python/contract.sh [--check] [--verbose] [--help]
#
# Writes openapi/warmly.v1.json from the running code. With --check nothing is
# written: the script fails if the committed contract differs from the code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CONTRACT="openapi/warmly.v1.json"

CHECK=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --check)
            CHECK=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            cat << HELP
Usage: $(basename "$0") [OPTIONS]

Export $CONTRACT from the FastAPI application.

OPTIONS:
    --check     Do not write; fail if the committed contract is stale
    --verbose   Show detailed output
    --help      Display this help message

EXIT CODES:
    0           Contract written, or up to date with --check
    1           Contract is stale (with --check)
    2           Error rendering the contract
HELP
            exit 0
            ;;
        *)
            echo "Error: Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

cd "$PROJECT_ROOT"

if $VERBOSE; then
    set -x
fi

echo "=== API contract (OpenAPI) ==="

if $CHECK; then
    RENDERED="$(mktemp)"
    trap 'rm -f "$RENDERED"' EXIT
    python -c "from warmly.contract import render_contract; print(render_contract(), end='')" > "$RENDERED" \
        || { echo "✗ Rendering the contract failed" >&2; exit 2; }
    if ! diff -u "$CONTRACT" "$RENDERED" > /dev/null 2>&1; then
        echo "✗ $CONTRACT is stale. Regenerate with: ./scripts/contract.sh" >&2
        exit 1
    fi
    echo "✓ OpenAPI contract matches the code"
else
    python -m warmly.contract || { echo "✗ Rendering the contract failed" >&2; exit 2; }
    echo "✓ Wrote $CONTRACT"
fi
exit 0
