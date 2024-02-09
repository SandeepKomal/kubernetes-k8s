# Installing CLI tools for K8's

### Install kubectl CLI tool on EC2:

```
curl -o kubectl https://s3.us-west-2.amazonaws.com/amazon-eks/1.23.7/2022-06-29/bin/linux/amd64/kubectl
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
kubectl version --short --client
```
### Install  Kustomize CLI tool on EC2:

```
curl --silent --location --remote-name \
  "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize/v3.2.3/kustomize_kustomize.v3.2.3_linux_amd64" && \
  chmod a+x kustomize_kustomize.v3.2.3_linux_amd64 && \
  sudo mv kustomize_kustomize.v3.2.3_linux_amd64 /usr/local/bin/kustomize
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

