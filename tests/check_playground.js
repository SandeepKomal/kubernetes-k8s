// Drives the site's playground simulator without a browser: every scenario
// starts broken, wrong moves keep it broken, and the intended fix solves it.
// Run with: node tests/check_playground.js
"use strict";
const path = require("path");
const assert = require("assert");

require(path.resolve(__dirname, "../site/playground.js"));
const { SCENARIOS, Cluster, kubectl, tokenize, parseMem } = globalThis.KQSim;

const text = (c, cmd) => kubectl(c, cmd).map(([t]) => t).join("\n");
// Run a command, then let the cluster settle as the page does: controllers
// may need a few rounds (a rollout, then an autoscaler acting on it).
function step(c, cmd) {
  const out = text(c, cmd);
  for (let i = 0; i < 5 && c.dirty; i++) c.settle();
  return out;
}
const fresh = (id) => new Cluster(SCENARIOS.find((s) => s.id === id));
const won = (c) => c.scenario.won(c);
const podOf = (c, owner) => c.podsOf(owner)[0].name;

assert.deepStrictEqual(tokenize(`kubectl patch svc a -p '{"x": 1}'`), ["kubectl", "patch", "svc", "a", "-p", '{"x": 1}']);
assert.strictEqual(parseMem("1Gi"), 1024);
assert.strictEqual(parseMem("512Mi"), 512);
assert.strictEqual(parseMem("lots"), null);

for (const s of SCENARIOS) {
  const c = new Cluster(s);
  assert.ok(!won(c), `${s.id}: must start broken`);
  assert.strictEqual(s.hints.length, 3, `${s.id}: three hints`);
  for (const cmd of [...s.tries, "kubectl get events", "kubectl get deploy", "kubectl get nodes"]) {
    assert.ok(text(c, cmd).length > 0, `${s.id}: "${cmd}" prints something`);
  }
}

// ImagePullBackOff: describe shows the typo; the right image fixes it.
let c = fresh("image");
assert.match(step(c, "kubectl get pods"), /menu\s+0\/1\s+ImagePullBackOff/);
assert.match(step(c, "kubectl describe pod menu"), /Failed to pull image "ngnix:1.27"/);
step(c, "kubectl set image pod/menu menu=nginx:latestt");
assert.ok(!won(c), "a second typo must not fix it");
step(c, "kubectl set image pod/menu menu=nginx:1.27");
assert.ok(won(c), "image: fixed by the right image");
c = fresh("image");
assert.match(step(c, "kubectl delete pod menu"), /nothing brings it back/);
assert.ok(!won(c));

// CrashLoopBackOff: logs name the variable; restarting or setting it on the Pod does not help.
c = fresh("crash");
assert.match(step(c, "kubectl get pods"), /orders-\S+\s+0\/1\s+CrashLoopBackOff\s+6/);
assert.match(step(c, "kubectl logs deployment/orders"), /MENU_FILE is not set/);
assert.match(step(c, `kubectl logs ${podOf(c, "orders")} --previous`), /fatal/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "orders")), /Exit Code:\s+1/);
step(c, "kubectl rollout restart deployment/orders");
assert.ok(!won(c), "a restart alone must not fix it");
assert.match(step(c, `kubectl set env pod/${podOf(c, "orders")} MENU_FILE=/x`), /Forbidden/);
step(c, `kubectl delete pod ${podOf(c, "orders")}`);
assert.ok(!won(c), "deleting the Pod must not fix it");
step(c, "kubectl set env deployment/orders MENU_FILE=");
assert.ok(!won(c), "an empty value must not fix it");
step(c, "kubectl set env deployment/orders MENU_FILE=/etc/menu/menu.json");
assert.ok(won(c), "crash: fixed by setting the variable on the Deployment");
assert.strictEqual(c.podsOf("orders").length, 1, "old Pods are gone after the rollout");
assert.match(step(c, "kubectl rollout status deployment/orders"), /successfully rolled out/);

// Pending: no node fits the request; a smaller request schedules it.
c = fresh("pending");
assert.match(step(c, "kubectl get pods -o wide"), /oven-\S+\s+0\/1\s+Pending.*<none>/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "oven")), /Insufficient memory/);
assert.match(step(c, "kubectl describe node worker-1"), /memory:\s+8Gi/);
assert.match(step(c, "kubectl set resources deployment/oven --requests=memory=512Mi --limits=memory=256Mi"), /must be less than or equal/);
step(c, "kubectl set resources deployment/oven --requests=memory=12Gi");
assert.ok(!won(c), "12Gi still fits no node");
step(c, "kubectl set resources deployment/oven --requests=memory=128Mi --limits=memory=128Mi");
assert.ok(!won(c), "a limit below the app's 300Mi gets it OOMKilled");
assert.match(step(c, "kubectl describe pod " + podOf(c, "oven")), /OOMKilled/);
step(c, "kubectl set resources deployment/oven --requests=memory=512Mi --limits=memory=1Gi");
assert.ok(won(c), "pending: fixed by a right-sized request");

// OOMKilled: exit 137; a bigger limit fixes it, undo brings it back.
c = fresh("oom");
assert.match(step(c, "kubectl describe pod " + podOf(c, "reports")), /OOMKilled[\s\S]*Exit Code:\s+137/);
step(c, "kubectl set resources deployment/reports --limits=memory=256Mi");
assert.ok(!won(c), "256Mi is still below the 400Mi it needs");
step(c, "kubectl set resources deployment/reports --limits=memory=512Mi");
assert.ok(won(c), "oom: fixed by a bigger limit");
step(c, "kubectl rollout undo deployment/reports");
assert.ok(!c.deploymentReady("reports"), "undo restores the broken limit");

// No endpoints: selector typo; relabelling is refused, fixing the selector works.
c = fresh("service");
assert.match(step(c, "kubectl get endpoints menu-svc"), /menu-svc\s+<none>/);
assert.match(step(c, "kubectl describe svc menu-svc"), /Selector:\s+app=menus/);
assert.match(step(c, "kubectl get pods --show-labels"), /app=menu,pod-template-hash=/);
step(c, "kubectl set selector service menu-svc app=menuu");
assert.ok(!won(c));
assert.match(step(c, "kubectl set selector service menu-svc app=menu"), /selector updated/);
assert.ok(won(c), "service: fixed by the selector");
assert.match(step(c, "kubectl get endpoints menu-svc"), /10\.244\.\d+\.\d+:80,10\.244/);

// Missing ConfigMap: CreateContainerConfigError until the right one exists;
// one without the key the app needs gets it crash-looping instead.
c = fresh("configmap");
assert.match(step(c, "kubectl get pods"), /orders-\S+\s+0\/1\s+CreateContainerConfigError/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "orders")), /configmap "orders-config" not found/);
assert.match(step(c, "kubectl get configmaps"), /order-config/);
step(c, "kubectl create configmap orders-config --from-literal=OTHER=1");
assert.match(step(c, "kubectl get pods"), /orders-\S+\s+0\/1\s+CrashLoopBackOff/);
assert.ok(!won(c), "a ConfigMap without MENU_FILE must not fix it");
step(c, "kubectl delete configmap orders-config");
step(c, "kubectl create configmap orders-config --from-literal=MENU_FILE=/etc/menu/menu.json");
assert.ok(won(c), "configmap: fixed by creating the ConfigMap it references (the next restart reads it)");
assert.match(step(c, `kubectl exec ${podOf(c, "orders")} -- env`), /MENU_FILE=\/etc\/menu\/menu.json/);
c = fresh("configmap");
assert.match(step(c, `kubectl patch deployment orders -p '{"spec":{"template":{"spec":{"containers":[{"name":"orders","envFrom":[{"configMapRef":{"name":"order-config"}}]}]}}}}'`), /patched/);
assert.ok(won(c), "configmap: also fixed by pointing envFrom at the existing ConfigMap");

// Node selector: no node carries the label until one is labelled.
c = fresh("nodeselector");
assert.match(step(c, "kubectl describe pod " + podOf(c, "cache")), /didn't match Pod's node affinity\/selector/);
assert.match(step(c, "kubectl get nodes --show-labels"), /kubernetes.io\/hostname=worker-1/);
step(c, "kubectl label node worker-3 disk=hdd");
assert.ok(!won(c), "the wrong label value must not fix it");
assert.match(step(c, "kubectl label node worker-3 disk=ssd"), /already has a value/);
step(c, "kubectl label node worker-3 disk=ssd --overwrite");
assert.ok(won(c), "nodeselector: fixed by labelling a node");
assert.match(step(c, "kubectl get pods -o wide"), /cache-\S+\s+1\/1\s+Running.*worker-3/);

// Readiness probe: Running but not Ready, no endpoints; removing the probe is not the fix.
c = fresh("probe");
assert.match(step(c, "kubectl get pods"), /menu-\S+\s+0\/1\s+Running/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "menu")), /Readiness probe failed: HTTP probe failed with statuscode: 404/);
assert.match(step(c, "kubectl logs deployment/menu"), /GET \/ready HTTP\/1.1" 404/);
assert.match(step(c, "kubectl get endpoints menu-svc"), /<none>/);
assert.match(step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","readinessProbe":null}]}}}}'`), /nothing then checks/);
assert.ok(!won(c), "removing the probe must not count");
c = fresh("probe");
assert.match(step(c, "kubectl patch deployment menu -p 'not json'"), /unable to parse/);
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'`);
assert.ok(won(c), "probe: fixed by a path the app serves");

// NetworkPolicy: blocked until the allow rule names the web Pods; deleting the deny is not the fix.
c = fresh("netpol");
const webPod = () => podOf(c, "web");
assert.match(step(c, `kubectl exec ${webPod()} -- wget -qO- -T 2 http://api-svc:8080`), /download timed out/);
assert.match(step(c, `kubectl exec ${webPod()} -- curl -s --max-time 2 api-svc:8080`), /curl: \(28\)/);
assert.match(step(c, "kubectl describe networkpolicy allow-frontend-to-api"), /PodSelector: app=frontend/);
assert.match(step(c, "kubectl get networkpolicy"), /default-deny-ingress\s+<none>/);
step(c, "kubectl label pod " + webPod() + " app=frontend");
assert.ok(!won(c), "relabelling Pods is refused");
assert.match(step(c, "kubectl delete networkpolicy default-deny-ingress"), /open again/);
assert.ok(c.reach(c.podsOf("web")[0], "api-svc", 8080).ok === false, "the allow policy still isolates api");
c = fresh("netpol");
step(c, `kubectl patch networkpolicy allow-frontend-to-api -p '{"spec":{"ingress":[{"from":[{"podSelector":{"matchLabels":{"app":"web"}}}],"ports":[{"port":8080}]}]}}'`);
assert.ok(won(c), "netpol: fixed by allowing app=web");
assert.match(step(c, `kubectl exec ${webPod()} -- wget -qO- -T 2 http://api-svc:8080`), /api: ok/);
assert.match(step(c, `kubectl exec ${webPod()} -- wget -qO- -T 2 http://api-svc:80`), /Connection refused/);

// RBAC: forbidden until the binding names the right ServiceAccount; cluster-admin is not the fix.
c = fresh("rbac");
const sa = "system:serviceaccount:kitchen:reporter";
assert.match(step(c, "kubectl logs deployment/reporter"), /pods is forbidden/);
assert.strictEqual(step(c, `kubectl auth can-i list pods --as=${sa}`), "no");
assert.strictEqual(step(c, "kubectl auth can-i delete pods"), "yes");
assert.match(step(c, "kubectl describe rolebinding read-pods"), /ServiceAccount\s+reporter-sa/);
assert.match(step(c, "kubectl describe role pod-reader"), /\[get list watch\]/);
assert.match(step(c, `kubectl create clusterrolebinding reporter-admin --clusterrole=cluster-admin --serviceaccount=kitchen:reporter`), /Least privilege/);
assert.ok(!won(c), "cluster-admin must not count");
step(c, "kubectl delete clusterrolebinding reporter-admin");
step(c, "kubectl set subject rolebinding read-pods --serviceaccount=kitchen:reporter");
assert.ok(won(c), "rbac: fixed by binding the right ServiceAccount");
assert.match(step(c, "kubectl logs deployment/reporter"), /report sent/);
c = fresh("rbac");
step(c, "kubectl create rolebinding reporter-read --role=pod-reader --serviceaccount=kitchen:reporter");
assert.ok(won(c), "rbac: also fixed by a new RoleBinding");

// Bad rollout: old Pods keep serving; undo returns to the last good version.
c = fresh("rollout");
assert.match(step(c, "kubectl rollout status deployment/web"), /Waiting for deployment "web" rollout to finish: 1 out of 2/);
assert.match(step(c, "kubectl get rs"), /web-\S+\s+2\s+1\s+0/);
assert.match(step(c, "kubectl rollout history deployment/web"), /2\s+image nginx:2.0/);
assert.strictEqual(c.pods.filter((x) => x.owner === "web" && x.ready).length, 2, "old Pods keep serving");
step(c, "kubectl rollout restart deployment/web");
assert.ok(!won(c), "a restart keeps the broken image");
step(c, "kubectl rollout undo deployment/web");
assert.ok(won(c), "rollout: fixed by undo");
assert.strictEqual(c.podsOf("web").length, 2, "only the new ReplicaSet's Pods remain");

// Liveness probe on the wrong port: restarts until it checks the right one.
c = fresh("liveness");
assert.match(step(c, "kubectl get pods"), /menu-\S+\s+0\/1\s+CrashLoopBackOff\s+7/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "menu")), /Liveness probe failed: Get "http:\/\/[\d.]+:8080\/"[\s\S]*failed liveness probe, will be restarted/);
assert.match(step(c, `kubectl logs ${podOf(c, "menu")} --previous`), /SIGTERM/);
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","livenessProbe":{"httpGet":{"port":8081}}}]}}}}'`);
assert.ok(!won(c), "another wrong port must not fix it");
assert.match(step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","livenessProbe":null}]}}}}'`), /nobody restarts the app/);
assert.ok(!won(c), "removing the liveness probe must not count");
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","livenessProbe":{"httpGet":{"port":80}}}]}}}}'`);
assert.ok(won(c), "liveness: fixed by probing port 80");

// Init container waiting for a Service that does not exist.
c = fresh("init");
assert.match(step(c, "kubectl get pods"), /orders-\S+\s+0\/1\s+Init:0\/1/);
assert.match(step(c, `kubectl logs ${podOf(c, "orders")} -c wait-for-menu`), /can't resolve 'menu-svc/);
assert.match(step(c, `kubectl logs ${podOf(c, "orders")}`), /PodInitializing/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "orders")), /Init Containers:[\s\S]*until nslookup menu-svc/);
step(c, "kubectl expose deployment menu --port=80");
assert.ok(!won(c), "a Service with another name must not fix it");
assert.match(step(c, "kubectl expose deployment menu --name=menu-svc --port=80"), /exposed/);
assert.ok(won(c), "init: fixed by creating the Service it waits for");
assert.match(step(c, "kubectl get endpoints menu-svc"), /10\.244/);

// Taint: needs a toleration; removing the taint is not the fix.
c = fresh("taint");
assert.match(step(c, "kubectl describe pod " + podOf(c, "trainer")), /1 node\(s\) had untolerated taint \{gpu: true\}, 2 node\(s\) didn't match/);
assert.match(step(c, "kubectl describe node worker-3"), /Taints:\s+gpu=true:NoSchedule/);
step(c, "kubectl taint node worker-3 gpu-");
assert.ok(c.deploymentReady("trainer") && !won(c), "untainting schedules it, but the node is no longer reserved");
c = fresh("taint");
step(c, `kubectl patch deployment trainer -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"gpu","operator":"Equal","value":"false","effect":"NoSchedule"}]}}}}'`);
assert.ok(!won(c), "a toleration with the wrong value must not fix it");
step(c, `kubectl patch deployment trainer -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"gpu","operator":"Equal","value":"true","effect":"NoSchedule"}]}}}}'`);
assert.ok(won(c), "taint: fixed by a matching toleration");
assert.match(step(c, "kubectl get pods -o wide"), /trainer-\S+\s+1\/1\s+Running.*worker-3/);

// HPA <unknown>: needs CPU requests; scaling by hand is not the fix.
c = fresh("hpa");
assert.match(step(c, "kubectl get hpa"), /cpu: <unknown>\/70%\s+2\s+6\s+2/);
assert.match(step(c, "kubectl describe hpa web"), /missing request for cpu/);
assert.match(step(c, "kubectl top pods"), /web-\S+\s+170m/);
assert.match(step(c, "kubectl scale deployment/web --replicas=4"), /HorizontalPodAutoscaler manages/);
assert.ok(!won(c), "manual scaling must not count");
c = fresh("hpa");
assert.match(step(c, "kubectl set resources deployment/web --requests=cpu=lots"), /invalid requests cpu/);
step(c, "kubectl set resources deployment/web --requests=cpu=100m");
assert.ok(won(c), "hpa: fixed by CPU requests");
assert.match(step(c, "kubectl get hpa"), /cpu: \d+%\/70%\s+2\s+6\s+5/);
assert.match(step(c, "kubectl describe hpa web"), /SuccessfulRescale\s+New size: 5/);

// VPA in Off mode: apply its advice by hand, or let it act.
c = fresh("vpa");
assert.match(step(c, "kubectl get vpa"), /reports-vpa\s+Off\s+25m\s+450Mi/);
assert.match(step(c, "kubectl describe vpa reports-vpa"), /Update Mode:\s+Off[\s\S]*Target:\s+memory: 450Mi/);
assert.match(step(c, `kubectl patch vpa reports-vpa -p '{"spec":{"updatePolicy":{"updateMode":"Sometimes"}}}'`), /Unsupported value/);
assert.match(step(c, `kubectl patch vpa reports-vpa -p '{"spec":{"updatePolicy":{"updateMode":"Recreate"}}}'`), /will not evict/);
assert.ok(!won(c), "the updater leaves single-replica workloads alone by default");
step(c, `kubectl patch vpa reports-vpa -p '{"spec":{"updatePolicy":{"minReplicas":1}}}'`);
assert.ok(won(c), "vpa: fixed by letting the VPA apply its recommendation");
assert.match(step(c, "kubectl describe pod " + podOf(c, "reports")), /Limits:\s+memory:\s+900Mi[\s\S]*Requests:\s+memory:\s+450Mi/);
c = fresh("vpa");
step(c, "kubectl set resources deployment/reports --requests=memory=450Mi --limits=memory=900Mi");
assert.ok(won(c), "vpa: also fixed by applying the recommendation by hand");

// Pod Security: no Pod at all; the ReplicaSet holds the reason.
c = fresh("podsecurity");
assert.match(step(c, "kubectl get pods"), /No resources found/);
assert.match(step(c, "kubectl describe deployment menu"), /ReplicaFailure\s+True\s+FailedCreate/);
const rs = step(c, "kubectl get rs").match(/menu-\S+/)[0];
assert.match(step(c, "kubectl describe rs " + rs), /violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false/);
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"securityContext":{"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"menu","securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}}}'`);
assert.match(step(c, "kubectl get pods"), /menu-\S+\s+0\/1\s+CreateContainerConfigError/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "menu")), /runAsNonRoot and image will run as root/);
assert.ok(!won(c), "runAsNonRoot without a non-root user is not enough for a root image");
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"securityContext":{"runAsUser":65534}}}}}'`);
assert.ok(won(c), "podsecurity: fixed by meeting the restricted level");
c = fresh("podsecurity");
assert.match(step(c, "kubectl label namespace kitchen pod-security.kubernetes.io/enforce=privileged --overwrite"), /lowering the security level/);
assert.ok(c.deploymentReady("menu") && !won(c), "lowering the namespace level runs the Pod but does not count");

// PVC Pending: no default StorageClass; the claim's class cannot be edited.
c = fresh("pvc");
assert.match(step(c, "kubectl describe pod " + podOf(c, "uploads")), /pod has unbound immediate PersistentVolumeClaims/);
assert.match(step(c, "kubectl get pvc"), /uploads-data\s+Pending/);
assert.match(step(c, "kubectl describe pvc uploads-data"), /no storage class is set/);
assert.match(step(c, `kubectl patch pvc uploads-data -p '{"spec":{"storageClassName":"standard"}}'`), /spec is immutable after creation/);
assert.match(step(c, "kubectl delete pvc uploads-data"), /pvc-protection/);
assert.ok(!won(c), "deleting the claim must not fix it");
c = fresh("pvc");
assert.doesNotMatch(step(c, "kubectl get storageclass"), /\(default\)/);
step(c, `kubectl patch storageclass standard -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'`);
assert.ok(won(c), "pvc: fixed by restoring the default StorageClass");
assert.match(step(c, "kubectl get pvc"), /uploads-data\s+Bound\s+pvc-\S+\s+1Gi\s+RWO\s+standard/);

// Ingress 404: no class, so no controller serves it.
c = fresh("ingress404");
assert.match(step(c, "curl -i http://menu.kitchen.example/"), /HTTP\/1.1 404 Not Found/);
assert.match(step(c, "kubectl get ingress"), /menu\s+<none>\s+menu.kitchen.example\s+80/);
assert.match(step(c, "curl http://menu-svc/"), /Could not resolve host: menu-svc.*only resolve inside the cluster/);
step(c, `kubectl patch ingress menu -p '{"spec":{"ingressClassName":"traefik"}}'`);
assert.ok(!won(c), "a class with no controller must not fix it");
step(c, `kubectl patch ingress menu -p '{"spec":{"ingressClassName":"nginx"}}'`);
assert.ok(won(c), "ingress404: fixed by the class");
assert.match(step(c, "curl http://menu.kitchen.example/"), /Welcome to nginx/);
assert.match(step(c, `kubectl exec ${podOf(c, "api")} -- wget -qO- http://menu.kitchen.example/`), /Welcome to nginx/);

// Ingress 503: the backend Service name is wrong.
c = fresh("ingress503");
assert.match(step(c, "curl -i http://menu.kitchen.example/"), /503 Service Temporarily Unavailable/);
assert.match(step(c, "kubectl describe ingress menu"), /menu-service:80 \(<error: endpoints "menu-service" not found>\)/);
step(c, `kubectl patch ingress menu -p '{"spec":{"rules":[{"http":{"paths":[{"backend":{"service":{"name":"menu-svc","port":{"number":8080}}}}]}}]}}'`);
assert.ok(!won(c), "the right Service on the wrong port is still 503");
assert.match(step(c, "kubectl describe ingress menu"), /has no port 8080/);
step(c, `kubectl patch ingress menu -p '{"spec":{"rules":[{"http":{"paths":[{"backend":{"service":{"name":"menu-svc","port":{"number":80}}}}]}}]}}'`);
assert.ok(won(c), "ingress503: fixed by the backend");

// DNS across namespaces: a bare name only searches the Pod's namespace.
c = fresh("dns");
assert.match(step(c, "kubectl logs deployment/checkout"), /lookup payments-svc on 10.96.0.10:53: no such host/);
assert.match(step(c, "kubectl get svc"), /No resources found in kitchen namespace/);
assert.match(step(c, "kubectl get svc -A"), /payments\s+payments-svc/);
assert.match(step(c, "kubectl get svc -n payments"), /payments-svc\s+ClusterIP/);
assert.match(step(c, `kubectl exec ${podOf(c, "web")} -- nslookup payments-svc`), /NXDOMAIN/);
assert.match(step(c, `kubectl exec ${podOf(c, "web")} -- nslookup payments-svc.payments`), /payments-svc.payments.svc.cluster.local/);
step(c, "kubectl set env deployment/checkout PAYMENTS_URL=http://payments-svc.payments:80");
assert.ok(!won(c), "the wrong port must not fix it");
step(c, "kubectl set env deployment/checkout PAYMENTS_URL=http://payments-svc.payments:8080");
assert.ok(won(c), "dns: fixed by the namespace-qualified name");

// Quota exceeded: right-size the request; raising or removing the quota does not count.
c = fresh("quota");
assert.match(step(c, "kubectl get quota"), /requests.memory: 320Mi\/512Mi/);
const ors = step(c, "kubectl get rs").match(/orders-\S+/)[0];
assert.match(step(c, "kubectl describe rs " + ors), /exceeded quota: kitchen-quota, requested: requests.memory=256Mi, used: requests.memory=320Mi, limited: requests.memory=512Mi/);
step(c, `kubectl patch quota kitchen-quota -p '{"spec":{"hard":{"requests.memory":"1Gi"}}}'`);
assert.ok(c.deploymentReady("orders") && !won(c), "raising the quota runs it but does not count");
c = fresh("quota");
assert.match(step(c, "kubectl delete quota kitchen-quota"), /no memory budget/);
assert.ok(!won(c), "removing the quota does not count");
c = fresh("quota");
step(c, "kubectl set resources deployment/orders --requests=memory=128Mi");
assert.ok(won(c), "quota: fixed by a right-sized request");

// Failed Job: immutable; delete and create again with the right URL.
c = fresh("job");
assert.match(step(c, "kubectl get jobs"), /import-menu\s+Failed\s+0\/1/);
assert.match(step(c, "kubectl describe job import-menu"), /4 Failed[\s\S]*BackoffLimitExceeded/);
assert.match(step(c, "kubectl logs job/import-menu"), /menu-svc:8080[\s\S]*Connection refused/);
assert.match(step(c, `kubectl patch job import-menu -p '{"spec":{"backoffLimit":10}}'`), /field is immutable/);
assert.match(step(c, "kubectl create job import-menu --image=busybox:1.36 -- wget -qO- http://menu-svc/menu.json"), /already exists/);
step(c, "kubectl delete job import-menu");
step(c, "kubectl create job import-menu --image=busybox:1.36 -- wget -qO- http://menu-svc:8080/menu.json");
assert.ok(!won(c), "the same wrong URL fails again");
step(c, "kubectl delete job import-menu");
step(c, "kubectl create job import-menu --image=busybox:1.36 -- wget -qO- http://menu-svc/menu.json");
assert.ok(won(c), "job: fixed by the right URL");
assert.match(step(c, "kubectl get jobs"), /import-menu\s+Complete\s+1\/1/);

// Drain blocked by a PodDisruptionBudget.
c = fresh("drain");
assert.match(step(c, "kubectl drain worker-2"), /cannot delete DaemonSet-managed Pods/);
assert.match(step(c, "kubectl drain worker-2 --ignore-daemonsets"), /violate the pod's disruption budget/);
assert.match(step(c, "kubectl get nodes"), /worker-2\s+Ready,SchedulingDisabled/);
assert.match(step(c, "kubectl get pdb"), /web-pdb\s+2\s+N\/A\s+0/);
assert.ok(!won(c));
step(c, "kubectl drain worker-2 --ignore-daemonsets --disable-eviction");
assert.ok(!won(c), "bypassing the budget does not count");
c = fresh("drain");
step(c, "kubectl delete pdb web-pdb");
step(c, "kubectl drain worker-2 --ignore-daemonsets");
assert.ok(!won(c), "deleting the budget does not count");
c = fresh("drain");
step(c, "kubectl scale deployment/web --replicas=3");
assert.match(step(c, "kubectl drain worker-2 --ignore-daemonsets"), /node\/worker-2 drained/);
assert.ok(won(c), "drain: fixed by scaling up first");
assert.doesNotMatch(step(c, "kubectl get pods -o wide"), /worker-2/);

// Errors stay errors.
c = fresh("crash");
assert.match(text(c, "kubectl describe pod nope"), /NotFound/);
assert.match(text(c, "kubectl get pods -n other"), /No resources found in other namespace/);
assert.match(text(c, "kubectl scale deployment/orders --replicas=99"), /0 to 6/);

// The troubleshooting reference links only to scenarios that exist.
global.window = {};
require(path.resolve(__dirname, "../site/data.js"));
const ids = new Set(SCENARIOS.map((x) => x.id));
for (const d of window.QUEST.doctor) for (const id of d.scenarios || []) assert.ok(ids.has(id), `doctor "${d.status}" links to unknown scenario ${id}`);
assert.strictEqual(new Set(window.QUEST.doctor.map((d) => d.status.toLowerCase().replace(/[^a-z0-9]+/g, "-"))).size, window.QUEST.doctor.length, "doctor links must be unique");

console.log(`playground ok: ${SCENARIOS.length} scenarios`);
