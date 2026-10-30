# shellcheck shell=bash
check "http://kitchen answers" http_ok http://kitchen
check "kitchen-public is a NodePort Service" eq "$(jp service/kitchen-public '{.spec.type}')" "NodePort"
check "kitchen-public uses node port 30080" eq "$(jp service/kitchen-public '{.spec.ports[0].nodePort}')" 30080
check "kitchen-public has endpoints" has_endpoints kitchen-public
check "http://kitchen-public answers" http_ok http://kitchen-public
