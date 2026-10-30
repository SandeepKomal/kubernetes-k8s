# shellcheck shell=bash
r='{.spec.template.spec.containers[0].resources'
check "requests cpu=100m" eq "$(jp deployment/reports "$r.requests.cpu}")" "100m"
check "requests memory=64Mi" eq "$(jp deployment/reports "$r.requests.memory}")" "64Mi"
check "limits equal requests" eq "$(jp deployment/reports "$r.limits.cpu}/$r.limits.memory}")" "100m/64Mi"
check "the rollout is complete" rolled_out deployment/reports
check "2 replicas are Ready" eq "$(jp deployment/reports '{.status.readyReplicas}')" 2
pod=$(kubectl -n "$NS" get pods -l app=reports -o name 2>/dev/null | head -n1)
check "QoS class is Guaranteed" eq "$(jp "${pod:-pod/none}" '{.status.qosClass}')" "Guaranteed"
check "the quota team-budget still exists" exists resourcequota/team-budget
