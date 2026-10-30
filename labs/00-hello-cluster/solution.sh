#!/usr/bin/env bash
# Reference solution for Level 00.
set -euo pipefail
kubectl -n "$NS" run hello --image=nginx:1.27 --labels=team=kitchen
kubectl -n "$NS" wait --for=condition=Ready pod/hello --timeout=90s
