#!/usr/bin/env bash
# Let revision 1 roll out, then start a broken revision 2.
set -euo pipefail
kubectl -n "$NS" rollout status deployment/storefront --timeout=120s
kubectl -n "$NS" set image deployment/storefront web=nginx:1.99-beta
