# shellcheck shell=bash
check "web is rolled out" rolled_out deployment/web
check "http://web shows Today's menu" http_says http://web "Today's menu"
check "a native sidecar runs next to nginx" test -n "$(jp deployment/web '{.spec.template.spec.initContainers[?(@.restartPolicy=="Always")].name}')"
check "http://web/updated.txt exists" http_ok http://web/updated.txt
