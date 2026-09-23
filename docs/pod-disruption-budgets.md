# Pod Disruption Budgets

A PodDisruptionBudget (PDB) helps protect application availability during voluntary disruptions such as node maintenance or cluster operations.

## Example

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: web
```

For a highly available application, make sure the Deployment has enough replicas for the selected PDB to make sense.

## Check the PDB

```bash
kubectl get pdb
kubectl describe pdb web-pdb
```

PDBs do not protect against every failure. They primarily constrain voluntary disruptions handled through Kubernetes eviction mechanisms.
