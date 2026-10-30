# shellcheck shell=bash
check "the Pod ledger is Ready" pod_ready ledger
check "ledger-data is Bound" eq "$(jp pvc/ledger-data '{.status.phase}')" "Bound"
check "ledger mounts ledger-data" contains "$(jp pod/ledger "{.spec.volumes[*].persistentVolumeClaim.claimName}")" "ledger-data"
check "/data/ledger.txt exists" kubectl -n "$NS" exec ledger -- test -s /data/ledger.txt
