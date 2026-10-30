#!/usr/bin/env bash
# Prove a level works end to end on a real cluster:
#   1. after `quest start`, the checks FAIL (the level really starts broken)
#   2. after the reference solution, the checks PASS
# Usage: tests/run-level.sh <level-number>
set -euo pipefail
cd "$(dirname "$0")/.."
level=${1:?usage: tests/run-level.sh <level>}
export QUEST_HOME="${RUNNER_TEMP:-/tmp}/quest-home-$level"

./quest start "$level"

echo "--- expecting checks to fail before the fix"
if QUEST_WAIT=5 ./quest check "$level"; then
  echo "FAIL: level $level passes before anything was fixed" >&2
  exit 1
fi

echo "--- applying the reference solution"
./quest solve "$level"

echo "--- expecting checks to pass"
QUEST_WAIT=120 ./quest check "$level"
