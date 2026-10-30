# shellcheck shell=bash
endpoint_count() {
  kubectl -n "$NS" get endpointslices -l kubernetes.io/service-name=menu-api \
    -o 'jsonpath={.items[*].endpoints[?(@.conditions.ready==true)].addresses[*]}' 2>/dev/null | wc -w | tr -d ' '
}
check "Service menu-api has endpoints" has_endpoints menu-api
check "exactly 2 endpoints (the Deployment's Pods)" eq "$(endpoint_count)" 2
check "the debug Pod still exists" exists pod/menu-api-debug
check "the debug Pod is not behind the Service" eq "$(jp pod/menu-api-debug '{.metadata.labels.tier}')" "debug"
