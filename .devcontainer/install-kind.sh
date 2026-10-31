#!/usr/bin/env bash
# Installs kind in the dev container. Run once when the container is created.
set -euo pipefail
version=v0.30.0
arch=$(uname -m)
# Checksums from the release's kind-linux-<arch>.sha256sum files; update them with the version.
case "$arch" in
  x86_64) arch=amd64 sum=517ab7fc89ddeed5fa65abf71530d90648d9638ef0c4cde22c2c11f8097b8889 ;;
  aarch64 | arm64) arch=arm64 sum=7ea2de9d2d190022ed4a8a4e3ac0636c8a455e460b9a13ccf19f15d07f4f00eb ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac
curl -fsSLo /tmp/kind "https://kind.sigs.k8s.io/dl/${version}/kind-linux-${arch}"
echo "${sum}  /tmp/kind" | sha256sum -c -
sudo install -m 0755 /tmp/kind /usr/local/bin/kind
rm -f /tmp/kind
kind version

cat <<'MSG'

DevOps Nimbus Kubernetes is ready. In the terminal:
  ./nimbus up          create the practice cluster (1-2 minutes)
  ./nimbus ui          open the practice dashboard
  ./nimbus start 0     or work from the terminal only
MSG
