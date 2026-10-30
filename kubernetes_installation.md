# Installing CLI tools for K8's

### Install kubectl CLI tool on EC2:

```
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"   # keep within one minor version of your cluster
```
```
chmod +x ./kubectl
```
```
mkdir -p $HOME/bin && cp ./kubectl $HOME/bin/kubectl && export PATH=$PATH:$HOME/bin
```
```
echo 'export PATH=$PATH:$HOME/bin' >> ~/.bashrc
```
```
kubectl version --client
```
### Install  Kustomize CLI tool on EC2:

kubectl already includes Kustomize (`kubectl apply -k <dir>`, `kubectl kustomize <dir>`). Install the standalone CLI only if you need commands like `kustomize edit`.

```
curl --silent --location --remote-name \
  "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" && \
  bash install_kustomize.sh && sudo mv kustomize /usr/local/bin/kustomize
```
```
kustomize version
```
### Install  AWS CLI tool on EC2 :

```
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
```
```
unzip awscliv2.zip 
```
```
sudo ./aws/install 
```

### Install  eksctl CLI tool on EC2 :

for ARM systems, set ARCH to: `arm64`, `armv6` or `armv7`

```
ARCH=amd64
PLATFORM=$(uname -s)_$ARCH
```
```
curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$PLATFORM.tar.gz"
```
(Optional) Verify checksum
```
curl -sL "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_checksums.txt" | grep $PLATFORM | sha256sum --check
```
```
tar -xzf eksctl_$PLATFORM.tar.gz -C /tmp && rm eksctl_$PLATFORM.tar.gz
```
```
sudo mv /tmp/eksctl /usr/local/bin
```
