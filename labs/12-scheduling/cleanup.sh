#!/usr/bin/env bash
# Undo this level's cluster-wide changes. Safe to run at any time.
kubectl taint nodes --all dedicated=gpu:NoSchedule- >/dev/null 2>&1 || true
kubectl label nodes --all accelerator- >/dev/null 2>&1 || true
