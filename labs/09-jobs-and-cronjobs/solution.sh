#!/usr/bin/env bash
# Reference solution for Level 09.
set -euo pipefail
kubectl -n "$NS" patch cronjob cleanup --type=merge -p \
  '{"spec":{"suspend":false,"schedule":"*/15 * * * *","concurrencyPolicy":"Forbid","successfulJobsHistoryLimit":3}}'
kubectl -n "$NS" create job cleanup-now --from=cronjob/cleanup
kubectl -n "$NS" wait --for=condition=Complete job/cleanup-now --timeout=120s
