#!/usr/bin/env bash
# scripts/typescript/test.sh - Run unit tests with Vitest
# Usage: ./scripts/test.sh [--coverage] [--watch] [--verbose] [--help]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

COVERAGE=false
WATCH=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --coverage)
            COVERAGE=true
            shift
            ;;
        --watch)
            WATCH=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            cat << EOF
Usage: $(basename "$0") [OPTIONS]

Run unit tests using Vitest (jsdom). E2E tests live in e2e.sh.

OPTIONS:
    --coverage  Generate coverage report
    --watch     Watch mode (rerun on file changes)
    --verbose   Show detailed output
    --help      Display this help message

EXIT CODES:
    0           All tests passed
    1           Test failures
    2           Error running tests
EOF
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

echo "=== Running Tests (Vitest) ==="

VITEST_ARGS=()

if ! $WATCH; then
    VITEST_ARGS+=(run)
fi

if $COVERAGE; then
    VITEST_ARGS+=(--coverage)
fi

if $WATCH; then
    VITEST_ARGS+=(--watch)  # vitest without `run` watches by default
fi

npx vitest ${VITEST_ARGS[@]+"${VITEST_ARGS[@]}"} || { echo "✗ Tests failed" >&2; exit 1; }

echo "✓ Tests passed"
exit 0
