# Here's the Ubuntu-specific install for KIND:

## 1. Install Docker (if not already installed)

```bash
sudo apt update
sudo apt install -y docker.io -y
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
sudo chmod 666 /var/run/docker.sock

```

Log out and back in (or run `newgrp docker`) so the group change takes effect. Verify with:

```bash
docker run hello-world
```

## 2. Install kubectl

```bash
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/
kubectl version --client
```

## 3. Install KIND

```bash
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
kind version
```

(Check [KIND releases](https://github.com/kubernetes-sigs/kind/releases) for a newer version tag if you want the latest.)

## 4. Create a cluster

```bash
kind create cluster
```

This spins up a single-node cluster named `kind` and points your kubeconfig at it automatically.

Verify:

```bash
kubectl cluster-info --context kind-kind
kubectl get nodes
```

## 5. Multi-node cluster (optional)

```yaml
# kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
- role: worker
- role: worker
```

```bash
kind create cluster --config kind-config.yaml
```

## Common Ubuntu gotchas

- **Permission denied on docker.sock**: means the `usermod -aG docker` step didn't take effect yet — log out/in or reboot.
- **Low inotify limits** (pods stuck or cluster flaky): bump these:

```bash
sudo sysctl fs.inotify.max_user_watches=524288
sudo sysctl fs.inotify.max_user_instances=512
```

  Make permanent by adding those lines to `/etc/sysctl.conf`.
- **Ubuntu on WSL2**: works fine, just make sure Docker Desktop's WSL2 integration is enabled, or run Docker natively inside WSL2.
