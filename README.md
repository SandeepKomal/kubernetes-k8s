# Kubectl Commands 

### Cluster & Node management:

Display endpoint information about the master and services in the cluster

```
kubectl cluster-info
```
Display the Kubernetes version running on the client and server

```
kubectl version
```
Get the configuration of the cluster

```
kubectl config view 
```
List the API resources that are available

```
kubectl api-resources
```
List the API versions that are available

```
kubectl api-versions
```

List everything

```
kubectl get all --all-namespaces 
```

