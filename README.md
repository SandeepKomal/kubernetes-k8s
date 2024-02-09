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
Update the taints on one or more nodes

```
kubectl taint node <node_name> 
```

Describe a specific node.

```
kubectl describe node <node-name> 
```
Delete a node or multiple nodes

```
kubectl delete node <node_name> 
```
Display Resource usage (CPU/Memory/Storage) for nodes

```
kubectl top node <node_name>
```
Pods running on a node

```
kubectl get pods -o wide | grep <node_name>
```
Mark a node as unschedulable

```
kubectl cordon node <node_name> 
```
Mark node as schedulable

```
kubectl uncordon node <node_name>
```
Drain a node in preparation for maintenance.

```
kubectl drain node <node_name> 
```
Add or update the labels of one or more nodes

```
kubectl label node
```
