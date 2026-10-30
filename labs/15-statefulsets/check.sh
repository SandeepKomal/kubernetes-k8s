# shellcheck shell=bash
bound_claims() {
  kubectl -n "$NS" get pvc -o 'jsonpath={range .items[?(@.status.phase=="Bound")]}{.metadata.name}{"\n"}{end}' 2>/dev/null |
    grep -c '^data-orders-db-[0-2]$'
}
check "the Service orders-db is headless" eq "$(jp service/orders-db '{.spec.clusterIP}')" "None"
check "the StatefulSet is rolled out" rolled_out statefulset/orders-db
check "3 replicas are ready" eq "$(jp statefulset/orders-db '{.status.readyReplicas}')" 3
check "each replica has its own Bound claim" eq "$(bound_claims)" 3
check "orders-db-1.orders-db answers with its own name" http_says http://orders-db-1.orders-db:8080/id "orders-db-1"
