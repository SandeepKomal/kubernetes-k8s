# Level 08 · Data that survives

> **Ticket KK-108** · from the ledger team
>
> `ledger` writes every order to `/data/ledger.txt`, but its volume claim
> has been `Pending` for an hour. Apparently `fast-ssd` was a storage class
> on the old cluster. Use whatever this cluster offers by default, get
> `ledger` running, and prove the data outlives the Pod.

**You will learn:** PersistentVolumes, PersistentVolumeClaims and
StorageClasses, dynamic provisioning, access modes, and which fields of a
claim can never change.

## Mission

- [ ] The claim `ledger-data` is `Bound`
- [ ] The Pod `ledger` is Ready, with the claim mounted at `/data`
- [ ] `/data/ledger.txt` exists inside the Pod

## Field notes

```text
Pod ledger ──uses──▶ PVC ledger-data ──bound to──▶ PV pvc-1234 ──▶ real disk
                       "I need 1Gi,                  created by the
                        ReadWriteOnce,               StorageClass's
                        class X"                     provisioner
```

- A **PersistentVolumeClaim** is a request for storage. A
  **StorageClass** says how to create it (EBS gp3, a local folder, NFS...).
  When a claim names a class, a matching volume is created on demand.
- No `storageClassName` means "use the default class", marked
  `(default)` in `kubectl get storageclass`.
- A claim's class and access mode are **immutable**. To change them, delete
  the claim and create it again (on a real cluster, back up first).
- `ReadWriteOnce` = one node can mount it; `ReadWriteMany` needs storage
  that supports it, like EFS or NFS.

```bash
kubectl get storageclass
kubectl get pvc,pv
kubectl describe pvc ledger-data          # read the Events
kubectl exec ledger -- cat /data/ledger.txt
```

## Production lens

On EKS the default class is usually `gp3` through the EBS CSI driver, and
an EBS volume lives in one availability zone, so the Pod that uses it must
be scheduled in that zone too. That is why classes use
`volumeBindingMode: WaitForFirstConsumer`. Before deleting any claim on a
real cluster, check the class's `reclaimPolicy`: `Delete` destroys the data.

## Stretch goal

Delete the Pod, recreate it from `setup.yaml`'s Pod section, and run
`cat /data/ledger.txt` again: two timestamps, one from each Pod.
