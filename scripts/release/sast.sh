#!/usr/bin/env bash
# scripts/release/sast.sh - static security analysis of the app's code
# Usage: SEMGREP_RULES=<folder> ./scripts/release/sast.sh [--help]
#
# Runs Semgrep's security rules for Python, JavaScript and TypeScript over
# the backend, the frontend and the scripts (PRD §10, REL-002). A finding
# of the highest severity (ERROR) blocks. Lower ones are printed by a
# second, non-blocking pass so they can be read.
#
# SEMGREP_RULES is a checkout of https://github.com/semgrep/semgrep-rules
# at the commit CI pins (see .github/workflows/ci.yml). The rules are read
# from disk: nothing is fetched and nothing is sent anywhere.
#
# Exit codes: 0 nothing blocking; 1 a blocking finding; 2 the scan could
# not run. A scan that could not run is a failure, never a pass.

set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
    sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v semgrep > /dev/null 2>&1; then
    echo "SAST: could not run. semgrep is not installed." >&2
    exit 2
fi
if [[ -z "${SEMGREP_RULES:-}" || ! -d "$SEMGREP_RULES" ]]; then
    echo "SAST: could not run. SEMGREP_RULES must name a checkout of semgrep-rules." >&2
    exit 2
fi

# Every `security` folder under the three languages the app is written in.
configs=()
while IFS= read -r folder; do
    configs+=(--config "$folder")
done < <(find "$SEMGREP_RULES/python" "$SEMGREP_RULES/javascript" \
    "$SEMGREP_RULES/typescript" -type d -name security | sort)

if [[ "${#configs[@]}" -lt 10 ]]; then
    echo "SAST: could not run. Too few rule folders found in SEMGREP_RULES." >&2
    exit 2
fi

targets=(warmly src scripts config)
common=(--metrics=off --disable-version-check --quiet)

echo "SAST: lower-severity findings (these do not block):"
semgrep scan "${common[@]}" "${configs[@]}" --severity WARNING --severity INFO \
    "${targets[@]}" || true

status=0
semgrep scan "${common[@]}" "${configs[@]}" --severity ERROR --error \
    "${targets[@]}" || status=$?

case "$status" in
    0) echo "SAST: no blocking finding." ;;
    1) echo "SAST: BLOCKED. Semgrep found a high-severity problem. See above." >&2 ;;
    *)
        echo "SAST: could not run (semgrep exited with $status)." >&2
        status=2
        ;;
esac
exit "$status"
