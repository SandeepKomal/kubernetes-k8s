# shellcheck shell=bash
t='{.spec.template.spec'
c="$t.containers[0]"
blocked() { ! http_ok "$@"; }
spread_nodes() {
  kubectl -n "$NS" get pods -l app=checkout-api --field-selector=status.phase=Running \
    -o 'jsonpath={range .items[*]}{.spec.nodeName}{"\n"}{end}' 2>/dev/null | sort -u | grep -c .
}
check "at least 2 replicas" test "$(jp deployment/checkout-api '{.spec.replicas}')" -ge 2
check "spread across nodes by kubernetes.io/hostname" contains "$(jp deployment/checkout-api "$t.topologySpreadConstraints[*].topologyKey}")" "kubernetes.io/hostname"
check "a PDB keeps at least 1 replica" test -n "$(kubectl -n "$NS" get pdb -o 'jsonpath={.items[?(@.spec.selector.matchLabels.app=="checkout-api")].metadata.name}' 2>/dev/null)"
check "readiness probe" test -n "$(jp deployment/checkout-api "$c.readinessProbe}")"
check "liveness probe" test -n "$(jp deployment/checkout-api "$c.livenessProbe}")"
requests() { [ -n "$(jp deployment/checkout-api "$c.resources.requests.cpu}")" ] && [ -n "$(jp deployment/checkout-api "$c.resources.requests.memory}")" ]; }
check "CPU and memory requests" requests
check "a memory limit" test -n "$(jp deployment/checkout-api "$c.resources.limits.memory}")"
check "runs as non-root" contains "$(jp deployment/checkout-api "$t.securityContext.runAsNonRoot}$c.securityContext.runAsNonRoot}")" "true"
check "no privilege escalation" eq "$(jp deployment/checkout-api "$c.securityContext.allowPrivilegeEscalation}")" "false"
check "all capabilities dropped" eq "$(jp deployment/checkout-api "$c.securityContext.capabilities.drop[*]}")" "ALL"
check "read-only root filesystem" eq "$(jp deployment/checkout-api "$c.securityContext.readOnlyRootFilesystem}")" "true"
check "uses ServiceAccount checkout-api" eq "$(jp deployment/checkout-api "$t.serviceAccountName}")" "checkout-api"
check "the API token is not mounted" eq "$(jp deployment/checkout-api "$t.automountServiceAccountToken}")" "false"
check "the rollout is complete" rolled_out deployment/checkout-api
check "replicas run on different nodes" test "$(spread_nodes)" -ge 2
check "app=storefront can reach http://checkout-api" http_ok http://checkout-api app=storefront
check "other Pods cannot reach it" blocked http://checkout-api app=other
