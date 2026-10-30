#!/usr/bin/env bash
# Reference solution for Level 01.
set -euo pipefail

# The image is one of the few Pod fields you may change in place.
kubectl -n "$NS" set image pod/menu menu=nginx:1.27

# The command is immutable, so replace the Pod with a corrected copy.
kubectl -n "$NS" get pod orders -o yaml | sed 's/sleeep/sleep/' | kubectl -n "$NS" replace --force -f -

kubectl -n "$NS" wait --for=condition=Ready pod/menu pod/orders --timeout=90s
