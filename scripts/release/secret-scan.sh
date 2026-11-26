#!/usr/bin/env bash
# scripts/release/secret-scan.sh - look for secrets in every commit
# Usage: ./scripts/release/secret-scan.sh [--help]
#
# Runs gitleaks over the whole history of the repository (PRD §10,
# REL-002). CI installs the pinned version named below; locally:
#   go install github.com/zricethezav/gitleaks/v8@v8.30.1
#
# Exit codes: 0 no secret found; 1 a secret was found; 2 the scan could
# not run. A scan that could not run is a failure, never a pass.

set -euo pipefail

GITLEAKS_VERSION="v8.30.1"

if [[ "${1:-}" == "--help" ]]; then
    sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    echo "Pinned version: $GITLEAKS_VERSION"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v gitleaks > /dev/null 2>&1; then
    echo "Secret scan: could not run. gitleaks is not installed." >&2
    echo "Install it: go install github.com/zricethezav/gitleaks/v8@$GITLEAKS_VERSION" >&2
    exit 2
fi

# --redact keeps anything found out of the log.
status=0
gitleaks git --no-banner --redact --exit-code 1 --config .gitleaks.toml . || status=$?

case "$status" in
    0) echo "Secret scan: no secret found in any commit." ;;
    1) echo "Secret scan: BLOCKED. gitleaks found something. See above." >&2 ;;
    *)
        echo "Secret scan: could not run (gitleaks exited with $status)." >&2
        status=2
        ;;
esac
exit "$status"
