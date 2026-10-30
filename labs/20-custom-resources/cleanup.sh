#!/usr/bin/env bash
# Undo this level's cluster-wide changes. Safe to run at any time.
kubectl delete crd menus.kitchen.example.com --ignore-not-found >/dev/null 2>&1 || true
