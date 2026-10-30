#!/usr/bin/env bash
# Reference solution for Level 08.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
kubectl -n "$NS" delete pod ledger --ignore-not-found
kubectl -n "$NS" delete pvc ledger-data --ignore-not-found
# Same objects, without the storage class that does not exist here.
grep -v 'storageClassName: fast-ssd' "$here/setup.yaml" | kubectl -n "$NS" apply -f -
kubectl -n "$NS" wait --for=condition=Ready pod/ledger --timeout=120s
