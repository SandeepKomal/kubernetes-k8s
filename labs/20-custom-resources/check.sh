# shellcheck shell=bash
crd=crd/menus.kitchen.example.com
cols() { kubectl get "$crd" -o 'jsonpath={.spec.versions[0].additionalPrinterColumns[*].jsonPath}' 2>/dev/null; }
min() { kubectl get "$crd" -o 'jsonpath={.spec.versions[0].schema.openAPIV3Schema.properties.spec.properties.price.minimum}' 2>/dev/null; }
items() { kubectl -n "$NS" get mn dinner -o 'jsonpath={range .spec.items[*]}{@}{"\n"}{end}' 2>/dev/null | grep -c .; }
check "kubectl get mn works" kubectl -n "$NS" get mn
check "a Price column shows .spec.price" contains "$(cols)" ".spec.price"
check "prices below 1 are still rejected" eq "$(min)" 1
check "Menu dinner exists" kubectl -n "$NS" get mn dinner
check "dinner has at least 2 items" test "$(items)" -ge 2
