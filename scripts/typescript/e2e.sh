#!/usr/bin/env bash
# scripts/typescript/e2e.sh - Run Playwright E2E + axe accessibility tests
# Usage: ./scripts/typescript/e2e.sh [--install] [--verbose] [--help]
#
# Builds the production PWA, serves it with `vite preview`, and runs e2e/ in
# desktop Chromium and mobile Safari (WebKit), per PRD AC-23 and AC-28.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

INSTALL=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --install)
            INSTALL=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            cat << HELP
Usage: $(basename "$0") [OPTIONS]

Run Playwright end-to-end and axe-core accessibility tests against the
production build (desktop Chromium + mobile Safari/WebKit).

OPTIONS:
    --install   Install the Playwright browsers first (chromium, webkit)
    --verbose   Show detailed output
    --help      Display this help message

EXIT CODES:
    0           All E2E tests passed
    1           E2E test failures
    2           Error running tests (e.g. browsers not installed)
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

if $INSTALL; then
    npx playwright install chromium webkit || { echo "✗ Browser install failed" >&2; exit 2; }
fi

echo "=== Running E2E + Accessibility Tests (Playwright, axe-core) ==="
npx playwright test || {
    echo "✗ E2E tests failed (if browsers are missing, re-run with --install)" >&2
    exit 1
}

echo "✓ E2E tests passed"
exit 0
