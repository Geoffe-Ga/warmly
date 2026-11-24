#!/usr/bin/env bash
# scripts/format.sh - Format code with Ruff (import order and layout)
# Usage: ./scripts/format.sh [--fix] [--check] [--verbose] [--help]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CHECK=false
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --fix)
            # Formatting in place is the default; the flag is accepted for symmetry.
            shift
            ;;
        --check)
            CHECK=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            cat << EOF
Usage: $(basename "$0") [OPTIONS]

Format code using Ruff: import order, then layout.

OPTIONS:
    --fix       Apply formatting changes (default)
    --check     Check only, fail if changes needed
    --verbose   Show detailed output
    --help      Display this help message

EXIT CODES:
    0           Code is properly formatted
    1           Formatting issues found
    2           Error running checks

EXAMPLES:
    $(basename "$0") --fix         # Apply formatting
    $(basename "$0") --check       # Check only
    $(basename "$0") --verbose     # Show detailed output
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

# Set verbosity
if $VERBOSE; then
    set -x
fi

echo "=== Formatting (Ruff) ==="

# Ruff is the only Python formatter, matching CI's `ruff format --check .`.
# Running a second formatter alongside it produced files the two disagreed on.
if $CHECK; then
    ruff check --select I . || { echo "✗ Import order check failed" >&2; exit 1; }
    ruff format --check . || { echo "✗ Ruff format failed" >&2; exit 1; }
else
    ruff check --select I --fix . || { echo "✗ Import sorting failed" >&2; exit 1; }
    ruff format . || { echo "✗ Ruff format failed" >&2; exit 1; }
fi

if $CHECK; then
    echo "✓ Code formatting check passed"
else
    echo "✓ Code formatted successfully"
fi
exit 0
