# Databases and Kubernetes

> **Reading only.** Nothing in this course runs a database. The YAML below
> illustrates patterns; it is not applied by any level, and you do not need
> to run it. Every concept it uses is practised hands-on with `busybox` in
> the levels linked at the end of each section.

Most applications store data in a database, so sooner or later you will
connect a workload to one. This guide explains the choices and the
Kubernetes patterns behind them.

## First decision: inside or outside the cluster?

| Option | What it means | Typical choice when |
| --- | --- | --- |
| Managed service outside the cluster | Amazon RDS or Aurora, Cloud SQL, Azure Database; the provider runs backups, failover, patching | Most production systems. The default recommendation |
| Operator inside the cluster | A controller (for example CloudNativePG for PostgreSQL) runs the database on StatefulSets and handles backups and failover | You need it on-premises, or close to the app, and have people to run it |
| Plain StatefulSet you write yourself | You own replication, backups, upgrades and recovery | Learning, short-lived test environments |

Running a database is mostly about the hard days: a failed disk, a lost
zone, a corrupted backup. A managed service or a mature operator has
already solved those; a hand-written StatefulSet has not.

## Connecting an app to a database outside the cluster

The application needs three things: where the database is, who it is, and
a password. Split them by sensitivity.

```yaml
# Not secret: safe in a ConfigMap and in Git.
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-db-config
data:
  DB_HOST: orders.example-cluster.eu-west-1.rds.amazonaws.com   # illustrative
  DB_PORT: "5432"
  DB_NAME: orders
---
# Secret: created by a secret manager integration, never committed to Git.
apiVersion: v1
kind: Secret
metadata:
  name: orders-db-credentials
type: Opaque
stringData:
  DB_USER: orders_app
  DB_PASSWORD: "<filled in by External Secrets or your platform>"
```

```yaml
# In the Deployment's container:
envFrom:
  - configMapRef:
      name: orders-db-config
  - secretRef:
      name: orders-db-credentials
```

Good practice:

- **Credentials from a secret manager.** Use the External Secrets Operator
  or the Secrets Store CSI driver to sync from AWS Secrets Manager, Vault
  or similar. On AWS, IAM database authentication (through IRSA or EKS Pod
  Identity) can remove the password entirely.
- **One user per application**, with only the rights it needs. Never the
  admin user.
- **A stable name for the database.** An `ExternalName` Service lets Pods
  use `orders-db` while the real hostname lives in one place:

  ```yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: orders-db
  spec:
    type: ExternalName
    externalName: orders.example-cluster.eu-west-1.rds.amazonaws.com
  ```

- **A NetworkPolicy egress rule** that allows the app to reach the database
  port and nothing else, plus security groups on the cloud side.
- **Readiness, not liveness, for database checks.** If the database is
  down, restarting every app Pod does not help and adds load when it comes
  back.

Practise the pieces: ConfigMaps and Secrets in
[level 05](../labs/05-configmaps-and-secrets/), probes in
[level 06](../labs/06-health-probes/), NetworkPolicy in
[level 11](../labs/11-network-policies/).

## Running a database inside the cluster

When a database does run in Kubernetes, it is a **StatefulSet**, because a
database replica needs:

| Need | Kubernetes feature |
| --- | --- |
| A stable identity (primary, replica-1) | Ordered Pod names: `db-0`, `db-1` |
| Its own disk that follows it | `volumeClaimTemplates`, one claim per replica |
| Peers that can find each other | A headless Service: `db-0.db.<namespace>.svc` |
| Careful start and stop | Ordered rollout, `terminationGracePeriodSeconds` long enough to flush |

The shape of it, illustratively:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  serviceName: db                 # a headless Service with clusterIP: None
  replicas: 3
  selector:
    matchLabels: {app: db}
  template:
    metadata:
      labels: {app: db}
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: db
          image: <database image, pinned to an exact version>
          envFrom:
            - secretRef: {name: db-credentials}
          volumeMounts:
            - {name: data, mountPath: /var/lib/data}
  volumeClaimTemplates:
    - metadata: {name: data}
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ebs-gp3   # an encrypted, Retain class
        resources: {requests: {storage: 50Gi}}
```

Rules that keep data safe:

- **Never expose it publicly.** Use a ClusterIP or headless Service, never
  a `LoadBalancer` on the database port.
- **Use a StorageClass with `reclaimPolicy: Retain`** so deleting a claim
  does not delete the disk.
- **Back up and test restores.** Volume snapshots or the database's own
  tools, stored outside the cluster. A backup you have never restored is
  a hope, not a backup.
- **Set a PodDisruptionBudget** so node upgrades never take down the
  primary and its replicas at once.
- **Spread replicas across zones** with topology spread constraints.

Practise the pieces with `busybox`: StatefulSets and headless Services in
[level 15](../labs/15-statefulsets/), storage in
[level 08](../labs/08-persistent-storage/), PodDisruptionBudgets in
[level 13](../labs/13-autoscaling/), spreading in
[level 21](../labs/21-boss-production-hardening/), and the reference
[StatefulSet example](../Kubernetes/k8's_objects/statefulset1/Statefulset.yaml).
