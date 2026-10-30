# shellcheck shell=bash
sa="system:serviceaccount:$NS:auditor"
check "auditor can list pods" can list pods "$sa"
check "auditor can watch pods" can watch pods "$sa"
check "auditor can read pod logs" eq "$(kubectl auth can-i get pods --subresource=log -n "$NS" --as="$sa" 2>/dev/null)" "yes"
check "auditor cannot delete pods" cannot delete pods "$sa"
check "auditor cannot read secrets" cannot get secrets "$sa"
check "auditor cannot list pods in kube-system" eq "$(kubectl auth can-i list pods -n kube-system --as="$sa" 2>/dev/null)" "no"
