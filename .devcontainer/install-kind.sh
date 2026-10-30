#!/usr/bin/env bash
# Installs kind in the dev container. Run once when the container is created.
set -euo pipefail
version=v0.30.0
arch=$(uname -m)
case "$arch" in
  x86_64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
esac
curl -fsSLo /tmp/kind "https://kind.sigs.k8s.io/dl/${version}/kind-linux-${arch}"
sudo install -m 0755 /tmp/kind /usr/local/bin/kind
rm -f /tmp/kind
kind version

cat <<'MSG'

Kubernetes Quest is ready. In the terminal:
  ./quest up          create the practice cluster (1-2 minutes)
  ./quest ui          open the practice dashboard
  ./quest start 0     or work from the terminal only
MSG
