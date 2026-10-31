#!/usr/bin/env bash
# Prove a level works end to end on a real cluster:
#   1. after `nimbus start`, the checks FAIL (the level really starts broken)
#   2. after the reference solution, the checks PASS
# Usage: tests/run-level.sh <level-number>
set -euo pipefail
cd "$(dirname "$0")/.."
level=${1:?usage: tests/run-level.sh <level>}
export NIMBUS_HOME="${RUNNER_TEMP:-/tmp}/nimbus-home-$level"

./nimbus start "$level"

echo "--- expecting checks to fail before the fix"
if NIMBUS_WAIT=5 ./nimbus check "$level"; then
  echo "FAIL: level $level passes before anything was fixed" >&2
  exit 1
fi

echo "--- applying the reference solution"
./nimbus solve "$level"

echo "--- expecting checks to pass"
NIMBUS_WAIT=120 ./nimbus check "$level"
