#!/usr/bin/env bash
# Reference solution for Level 10.
set -euo pipefail
kubectl -n "$NS" create role auditor --verb=get,list,watch --resource=pods,pods/log \
  --dry-run=client -o yaml | kubectl -n "$NS" replace -f -
