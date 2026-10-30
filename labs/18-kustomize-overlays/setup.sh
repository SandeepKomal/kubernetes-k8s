#!/usr/bin/env bash
# Copy the app's Kustomize files into a scratch folder the learner can edit,
# so the repository itself stays untouched.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${QUEST_HOME:-$HOME/.k8s-quest}/workspace/18-kustomize"
rm -rf "$work"
mkdir -p "$work"
cp -R "$here/app/." "$work/"
