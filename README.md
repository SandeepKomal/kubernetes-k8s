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



