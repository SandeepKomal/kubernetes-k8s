#!/usr/bin/env bash
# Pretend yesterday's version bump already happened: the template says 1.36,
# but with OnDelete the running Pods stay on 1.35.
set -euo pipefail
# `rollout status` does not support OnDelete, so wait for the Pods directly.
for _ in $(seq 60); do
  desired=$(kubectl -n "$NS" get ds node-agent -o 'jsonpath={.status.desiredNumberScheduled}')
  ready=$(kubectl -n "$NS" get ds node-agent -o 'jsonpath={.status.numberReady}')
  if [ "${desired:-0}" -gt 0 ] && [ "$ready" = "$desired" ]; then break; fi
  sleep 2
done
kubectl -n "$NS" set image daemonset/node-agent agent=busybox:1.36
