#!/usr/bin/env bash
# scripts/typescript/contract.sh - Generate TypeScript types from the OpenAPI contract
# Usage: ./scripts/typescript/contract.sh [--check] [--verbose] [--help]
#
# Reads openapi/warmly.v1.json (written by scripts/python/contract.sh) and
# writes src/api/schema.d.ts. With --check nothing is written: the script
# fails if the committed types differ from what the contract produces.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CONTRACT="openapi/warmly.v1.json"
TYPES="src/api/schema.d.ts"

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

Generate $TYPES from $CONTRACT.

OPTIONS:
    --check     Do not write; fail if the committed types are stale
    --verbose   Show detailed output
    --help      Display this help message

EXIT CODES:
    0           Types written, or up to date with --check
    1           Types are stale (with --check)
    2           Error running the generator
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

echo "=== API contract (TypeScript types) ==="

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
GENERATED="$WORK_DIR/schema.d.ts"

# The generator lives in its own lockfile-pinned package (tools/contract)
# because it requires TypeScript 5 while the app uses TypeScript 6.
TOOLS_DIR="tools/contract"
GENERATOR="$TOOLS_DIR/node_modules/.bin/openapi-typescript"
if [[ ! -x "$GENERATOR" ]]; then
    npm ci --prefix "$TOOLS_DIR" --silent \
        || { echo "✗ Installing $TOOLS_DIR failed" >&2; exit 2; }
fi

"$GENERATOR" "$CONTRACT" --output "$GENERATED" > /dev/null \
    || { echo "✗ Type generation failed" >&2; exit 2; }
# Format with the project's Prettier config so the output is stable.
npx prettier --stdin-filepath "$TYPES" < "$GENERATED" > "$GENERATED.formatted" \
    || { echo "✗ Formatting generated types failed" >&2; exit 2; }

if $CHECK; then
    if ! diff -u "$TYPES" "$GENERATED.formatted" > /dev/null 2>&1; then
        echo "✗ $TYPES is stale. Regenerate with: ./scripts/contract.sh" >&2
        exit 1
    fi
    echo "✓ TypeScript types match the contract"
else
    mkdir -p "$(dirname "$TYPES")"
    cp "$GENERATED.formatted" "$TYPES"
    echo "✓ Wrote $TYPES"
fi
exit 0
