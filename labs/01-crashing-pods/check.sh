# shellcheck shell=bash
check "menu runs nginx:1.27" eq "$(jp pod/menu '{.spec.containers[0].image}')" "nginx:1.27"
check "menu is Ready" pod_ready menu
check "orders is Ready" pod_ready orders
check "orders logs 'orders service up'" contains "$(kubectl -n "$NS" logs orders 2>/dev/null)" "orders service up"
