# shellcheck shell=bash
ns_label() { kubectl get namespace "$NS" -o 'jsonpath={.metadata.labels.pod-security\.kubernetes\.io/enforce}' 2>/dev/null; }
check "the namespace still enforces restricted" eq "$(ns_label)" "restricted"
check "payments is rolled out" rolled_out deployment/payments
check "2 replicas are ready" eq "$(jp deployment/payments '{.status.readyReplicas}')" 2
check "the root filesystem is read-only" eq "$(jp deployment/payments '{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}')" "true"
