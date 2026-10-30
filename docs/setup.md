# Set up your practice cluster

You need three tools. Everything runs on your machine; no cloud account,
no cost.

| Tool | What it is |
| --- | --- |
| Docker (or Podman) | Runs containers. kind runs each Kubernetes node as a container. |
| kind | "Kubernetes in Docker": a real, conformant cluster on your laptop |
| kubectl | The command-line client for every Kubernetes cluster |

About 4 GB of free memory is enough for the 3-node quest cluster.

## No install: GitHub Codespaces

Open the repository on GitHub and choose **Code → Codespaces → Create
codespace on main**, or use the badge in the README. Docker, kind, kubectl
and Python are installed for you. This uses your own GitHub account's free
Codespaces allowance; stop the codespace when you are done.

## macOS

```bash
brew install --cask docker     # or Docker Desktop / OrbStack / Colima
brew install kind kubectl
```

## Linux

Install Docker Engine for your distribution
(<https://docs.docker.com/engine/install/>), let your user run it, then:

```bash
sudo usermod -aG docker "$USER"   # log out and back in afterwards

# kubectl, latest stable
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl

# kind: check https://github.com/kubernetes-sigs/kind/releases for the latest tag
curl -Lo kind https://kind.sigs.k8s.io/dl/v0.30.0/kind-linux-amd64
sudo install -m 0755 kind /usr/local/bin/kind
```

On ARM machines replace `amd64` with `arm64`.

## Windows

Use WSL 2 with Ubuntu and Docker Desktop's WSL integration, then follow the
Linux steps inside WSL. `./quest` is a bash script, so run it from WSL.

## Check and start

```bash
./quest doctor     # ✔ docker, kind, kubectl
./quest up         # creates the k8s-quest cluster (1-2 minutes)
./quest list
./quest start 0
./quest ui         # optional: practice dashboard in your browser (needs python3)
```

When you are done for the day, `./quest down` deletes the cluster.
Your progress is kept in `~/.k8s-quest`.

## Troubleshooting the setup

| Symptom | Fix |
| --- | --- |
| `permission denied ... docker.sock` | Your user is not in the `docker` group yet: log out and in again |
| `kind create cluster` hangs or nodes are `NotReady` | Give Docker more memory (4 GB+). On Linux, raise inotify limits: `sudo sysctl fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=512` |
| `./quest` says the context is not `kind-k8s-quest` | Run `./quest up`, or `kubectl config use-context kind-k8s-quest` |
| Image pulls are slow or rate limited | Docker Hub limits anonymous pulls; `docker login` raises the limit |

More detail on kind itself is in [kind.md](../kind.md).
