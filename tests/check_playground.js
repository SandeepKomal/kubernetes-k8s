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

// HPA not scaling: needs CPU requests; scaling by hand is not the fix.
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

// Helm: a failed upgrade; fixing it with kubectl leaves the release drifted.
c = fresh("helm");
assert.match(step(c, "helm list"), /menu\s+kitchen\s+2\s+.*failed/);
assert.match(step(c, "helm get values menu --revision 2"), /tag: "2.0"/);
assert.match(step(c, "kubectl set image deployment/menu menu=nginx:1.27"), /belongs to Helm release menu/);
assert.ok(c.deploymentReady("menu") && !won(c), "a kubectl fix runs the Pods but the release stays failed and drifted");
c = fresh("helm");
assert.match(step(c, "helm rollback menu 1"), /Rollback was a success/);
assert.ok(won(c), "helm: fixed by rollback");
assert.match(step(c, "helm history menu"), /3\s+.*deployed\s+.*Rollback to 1/);
c = fresh("helm");
step(c, "helm upgrade menu ./charts/menu --set image.tag=1.27");
assert.ok(won(c), "helm: also fixed by an upgrade with good values");

// Gateway API: the route names a Gateway that does not exist.
c = fresh("gateway");
assert.match(step(c, "curl -i http://menu.kitchen.example/"), /404 Not Found/);
assert.match(step(c, "kubectl describe httproute menu"), /Accepted\s+Status: False\s+Reason: NoMatchingParent/);
assert.match(step(c, "kubectl describe gateway kitchen-gateway"), /Attached Routes:\s+0/);
step(c, `kubectl patch httproute menu -p '{"spec":{"parentRefs":[{"name":"kitchen-gateway"}]}}'`);
assert.ok(won(c), "gateway: fixed by the parentRef");
assert.match(step(c, "curl http://menu.kitchen.example/"), /Welcome to nginx/);

// Wrong namespace in the kubeconfig context.
c = fresh("context");
assert.match(step(c, "kubectl get pods"), /No resources found in default namespace/);
assert.match(step(c, "kubectl get pods -n kitchen"), /web-/);
assert.ok(!won(c), "passing -n every time does not change the default");
assert.match(step(c, "kubectl config set-context --current --namespace=kitchen"), /modified/);
assert.ok(won(c), "context: fixed by the context's namespace");
assert.match(step(c, "kubectl get pods"), /web-/);

// New user: approve the CSR, then bind a Role; cluster-admin does not count.
c = fresh("csr");
assert.match(step(c, "kubectl get csr"), /jane\s+.*Pending/);
assert.match(step(c, "kubectl get pods --as=jane"), /forbidden: User "jane" cannot list resource "pods"/);
step(c, "kubectl certificate approve jane");
assert.ok(!won(c), "an approved certificate alone gives no rights");
step(c, "kubectl create clusterrolebinding jane-admin --clusterrole=cluster-admin --user=jane");
assert.ok(!won(c), "cluster-admin is too much");
step(c, "kubectl delete clusterrolebinding jane-admin");
step(c, "kubectl create rolebinding jane-read-pods --role=pod-reader --user=jane");
assert.ok(won(c), "csr: fixed by approval and a read-only binding");
assert.match(step(c, "kubectl get pods --as=jane"), /web-/);

// CronJob suspended.
c = fresh("cronjob");
step(c, "kubectl create job report-now --from=cronjob/nightly-report");
assert.ok(!won(c), "a manual run alone leaves the schedule suspended");
step(c, `kubectl patch cronjob nightly-report -p '{"spec":{"suspend":false}}'`);
assert.ok(won(c), "cronjob: resumed and proven");

// Node NotReady: kubelet stopped and disabled.
c = fresh("nodenotready");
assert.match(step(c, "kubectl get nodes"), /worker-3\s+NotReady/);
assert.match(step(c, "ssh worker-3 sudo systemctl status kubelet"), /disabled[\s\S]*inactive \(dead\)/);
assert.match(step(c, "ssh worker-3 sudo journalctl -u kubelet"), /kubelet was not started/);
step(c, "ssh worker-3 sudo systemctl start kubelet");
assert.match(step(c, "kubectl get nodes"), /worker-3\s+Ready/);
assert.ok(!won(c), "started but still disabled: the next reboot breaks it again");
step(c, "ssh worker-3 sudo systemctl enable kubelet");
assert.ok(won(c), "node: fixed by enable and start");

// etcd backup: endpoint and certificates must match the etcd manifest.
c = fresh("etcd");
assert.match(step(c, "kubectl -n kube-system describe pod etcd-control-plane"), /--trusted-ca-file=\/etc\/kubernetes\/pki\/etcd\/ca.crt/);
assert.match(step(c, "etcdctl snapshot save /opt/backup/etcd.db"), /context deadline exceeded/);
assert.match(step(c, "etcdctl snapshot save /opt/backup/etcd.db --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key"), /unknown authority/);
assert.ok(!won(c));
const save = "ETCDCTL_API=3 etcdctl snapshot save /opt/backup/etcd.db --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key";
assert.match(step(c, save), /Snapshot saved at \/opt\/backup\/etcd.db/);
assert.ok(!won(c), "an unchecked backup does not count");
assert.match(step(c, "etcdutl snapshot status /opt/backup/etcd.db --write-out=table"), /TOTAL KEYS/);
assert.ok(won(c), "etcd: saved and verified");
assert.match(step(c, "ls /opt/backup"), /etcd.db/);

// etcd restore: never over the live data; a new directory, then the manifest.
c = fresh("etcdrestore");
assert.doesNotMatch(step(c, "kubectl get deploy"), /menu/);
assert.match(step(c, "ls /opt/backup"), /etcd-0300.db/);
assert.match(step(c, "etcdutl snapshot status /opt/backup/etcd-0300.db"), /TOTAL KEYS/);
assert.match(step(c, "etcdctl snapshot restore /opt/backup/etcd-0300.db --data-dir /var/lib/etcd-restore"), /unknown command "restore"/);
assert.match(step(c, "etcdutl snapshot restore /opt/backup/etcd-0300.db --data-dir /var/lib/etcd"), /not empty/);
step(c, "kubectl create deployment menu --image=nginx:1.27");
assert.ok(!won(c), "recreating by hand is not a restore");
c = fresh("etcdrestore");
assert.match(step(c, "etcdutl snapshot restore /opt/backup/etcd-0300.db --data-dir /var/lib/etcd-restore"), /restored snapshot/);
assert.match(step(c, "ls /var/lib"), /etcd-restore/);
assert.ok(!won(c), "a restored directory etcd does not use changes nothing");
step(c, "sed -i 's#--data-dir=/var/lib/etcd#--data-dir=/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml");
assert.match(step(c, "kubectl get deploy"), /refused/);
assert.match(step(c, "kubectl get deploy"), /refused/, "data dir and volume disagree: etcd stays down");
step(c, "sed -i 's#--data-dir=/var/lib/etcd-restore#--data-dir=/var/lib/etcd#' /etc/kubernetes/manifests/etcd.yaml");
step(c, "sed -i 's#path: /var/lib/etcd#path: /var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml");
assert.match(step(c, "kubectl get deploy"), /refused/, "etcd restarts once");
assert.match(step(c, "kubectl get deploy"), /menu\s+2\/2/);
assert.match(step(c, "kubectl get svc"), /menu-svc/);
assert.ok(won(c), "etcdrestore: fixed by restoring into a new directory and pointing etcd at it");

// kubeadm upgrade: repository, held packages, order, drain.
c = fresh("kubeadm");
assert.match(step(c, "kubectl get nodes"), /control-plane\s+Ready\s+control-plane\s+12d\s+v1.33.5/);
assert.match(step(c, "kubeadm upgrade plan"), /update kubeadm to v1.34.1/);
assert.match(step(c, "kubeadm upgrade apply v1.34.1"), /higher than the kubeadm version/);
assert.match(step(c, "apt-get install -y kubeadm=1.34.1-1.1"), /was not found/);
assert.match(step(c, "apt-cache madison kubeadm"), /1.33.5-1.1/);
step(c, "sed -i 's#v1.33#v1.34#' /etc/apt/sources.list.d/kubernetes.list");
assert.match(step(c, "apt-get install -y kubeadm=1.34.1-1.1"), /was not found/, "the index is stale until apt-get update");
step(c, "apt-get update");
assert.match(step(c, "apt-get install -y kubeadm=1.34.1-1.1"), /Held packages were changed/);
step(c, "apt-mark unhold kubeadm && apt-get install -y kubeadm=1.34.1-1.1 && apt-mark hold kubeadm");
assert.match(step(c, "kubeadm version"), /v1.34.1/);
// the kubelet must not run ahead of the API server
step(c, "apt-get install -y kubelet=1.34.1-1.1 --allow-change-held-packages");
step(c, "systemctl daemon-reload");
step(c, "systemctl restart kubelet");
assert.match(step(c, "kubectl get nodes"), /control-plane\s+NotReady/);
assert.match(step(c, "journalctl -u kubelet"), /newer than the API server/);
assert.match(step(c, "kubeadm upgrade apply v1.34.1 -y"), /SUCCESS/);
assert.match(step(c, "kubectl version"), /refused/, "the API server restarts");
assert.match(step(c, "kubectl version"), /Server Version: v1.34.1/);
assert.match(step(c, "systemctl restart kubelet"), /not drained/);
step(c, "apt-get install -y kubectl=1.34.1-1.1 --allow-change-held-packages");
assert.ok(!won(c), "the kubelet restarted on an undrained node");
assert.match(step(c, "kubectl drain control-plane"), /--ignore-daemonsets/);
assert.match(step(c, "kubectl drain control-plane --ignore-daemonsets"), /drained/);
step(c, "apt-get install -y kubelet=1.33.5-1.1 --allow-change-held-packages");
assert.match(step(c, "kubectl get nodes"), /control-plane\s+Ready,SchedulingDisabled/);
c = fresh("kubeadm");
for (const cmd of ["sed -i 's#v1.33#v1.34#' /etc/apt/sources.list.d/kubernetes.list", "apt-get update",
  "apt-mark unhold kubeadm && apt-get install -y kubeadm=1.34.1-1.1 && apt-mark hold kubeadm", "kubeadm upgrade plan",
  "kubeadm upgrade apply v1.34.1", "kubectl get nodes", "kubectl drain control-plane --ignore-daemonsets",
  "apt-mark unhold kubelet kubectl", "apt-get install -y kubelet=1.34.1-1.1 kubectl=1.34.1-1.1",
  "systemctl daemon-reload", "systemctl restart kubelet"]) step(c, cmd);
assert.ok(!won(c), "still cordoned and unheld");
step(c, "kubectl uncordon control-plane");
assert.ok(!won(c), "packages must be held again");
assert.match(step(c, "apt-mark hold kubelet kubectl"), /kubelet set on hold/);
assert.match(step(c, "kubectl get nodes control-plane"), /Ready\s+control-plane\s+12d\s+v1.34.1/);
assert.ok(won(c), "kubeadm: upgraded in order, drained, held");

// Audit log: find the user; a shared binding is the hole.
c = fresh("audit");
assert.match(step(c, "grep audit /etc/kubernetes/manifests/kube-apiserver.yaml"), /audit-log-path/);
const deletes = step(c, `grep '"verb":"delete"' /var/log/kubernetes/audit/audit.log`);
assert.match(deletes, /"username":"dev-intern"/);
assert.doesNotMatch(deletes, /"username":"jane"/);
assert.match(step(c, "kubectl auth can-i delete secrets --as=dev-intern"), /yes/);
step(c, "kubectl delete rolebinding kitchen-team");
assert.ok(!won(c), "deleting the shared binding locks ops-lead out too");
step(c, "kubectl create rolebinding ops-edit --clusterrole=edit --user=ops-lead");
assert.ok(!won(c), "dev-intern still needs to read Pods");
assert.doesNotMatch(step(c, "kubectl create rolebinding intern-view --clusterrole=view --user=dev-intern"), /Least privilege/);
assert.match(step(c, "kubectl auth can-i delete secrets --as=dev-intern"), /no/);
assert.ok(won(c), "audit: dev-intern can no longer delete Secrets");

// Encryption at rest: the flag, then rewrite the old Secrets.
c = fresh("encryption");
const certs = "--endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key";
const getSecret = `ETCDCTL_API=3 etcdctl get /registry/secrets/kitchen/payments-api ${certs} | hexdump -C`;
assert.match(step(c, getSecret), /sk_test_kitchen_4f9a/);
assert.match(step(c, "kubectl get secret payments-api -o yaml"), /api-key: c2tf/);
step(c, "kubectl get secrets -A -o json | kubectl replace -f -");
assert.ok(!won(c), "rewriting before encryption is on changes nothing");
step(c, "sed -i '/--etcd-servers/a\\    - --encryption-provider-config=/etc/kubernetes/encryption-config.yaml' /etc/kubernetes/manifests/kube-apiserver.yaml");
assert.match(step(c, "kubectl get secrets"), /refused/);
assert.match(step(c, "kubectl get secrets"), /refused/, "a missing config file keeps the API server down");
step(c, "sed -i '/encryption-provider-config/d' /etc/kubernetes/manifests/kube-apiserver.yaml");
step(c, "sed -i '/--etcd-servers/a\\    - --encryption-provider-config=/etc/kubernetes/pki/encryption-config.yaml' /etc/kubernetes/manifests/kube-apiserver.yaml");
assert.ok(c.files["/etc/kubernetes/manifests/kube-apiserver.yaml"].includes("    - --encryption-provider-config=/etc/kubernetes/pki/encryption-config.yaml"), "sed a\\ keeps the indentation");
step(c, "kubectl get pods");
assert.match(step(c, getSecret), /sk_test_kitchen_4f9a/, "existing Secrets stay plain text");
assert.ok(!won(c));
assert.match(step(c, "kubectl get secrets -A -o json | kubectl replace -f -"), /secret\/db-password replaced/);
assert.match(step(c, getSecret), /k8s:enc:aescbc:v1:key1/);
assert.ok(won(c), "encryption: enabled and rewritten");

// Untrusted registry: the policy stays, the image moves.
c = fresh("registry");
assert.match(step(c, "kubectl get deploy menu"), /menu\s+0\/2/);
assert.match(step(c, "kubectl get events"), /ValidatingAdmissionPolicy 'trusted-registry'/);
assert.match(step(c, "kubectl get validatingadmissionpolicy trusted-registry -o yaml"), /startsWith\('registry.kitchen.example\/'\)/);
step(c, "kubectl delete validatingadmissionpolicybinding trusted-registry-binding");
assert.ok(c.podsOf("menu").length > 0, "without the binding Pods are admitted");
assert.ok(!won(c), "deleting the binding does not count");
c = fresh("registry");
step(c, "kubectl set image deployment/menu menu=registry.example.com/nginx:1.27");
assert.ok(!won(c), "another registry is still rejected");
step(c, "kubectl set image deployment/menu menu=registry.kitchen.example/nginx:1.27");
assert.ok(won(c), "registry: fixed by using the company registry");

// Vulnerable image: scan the target version too.
c = fresh("trivy");
assert.match(step(c, "kubectl get deploy -o wide"), /menu.*nginx:1.25/);
assert.match(step(c, "trivy image nginx:1.25"), /CRITICAL: 1/);
assert.match(step(c, "trivy image nginx:1.27 --severity HIGH,CRITICAL"), /Total: 0/);
step(c, "kubectl set image deployment/menu menu=nginx:1.26");
assert.ok(!won(c), "1.26 still has the CRITICAL one");
step(c, "kubectl set image deployment/menu menu=nginx:1.27");
assert.ok(won(c), "trivy: moved to a clean image");

// AppArmor: the profile has to be on every node.
c = fresh("apparmor");
const wide = step(c, "kubectl get pods -o wide");
assert.match(wide, /Running.*worker-1/);
assert.match(wide, /CreateContainerError/);
const broken = c.podsOf("menu").find((p) => p.state === "CreateContainerError");
assert.match(step(c, `kubectl describe pod ${broken.name}`), /apparmor profile not found k8s-deny-write/);
assert.match(step(c, `ssh ${broken.node} sudo aa-status`), /1 profiles are loaded/);
assert.match(step(c, `ssh ${broken.node} sudo apparmor_parser -q /etc/apparmor.d/nope`), /not found/);
assert.match(step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"securityContext":{"appArmorProfile":{"type":"RuntimeDefault"}}}}}}'`), /removes the k8s-deny-write profile/);
assert.ok(!won(c), "a different profile does not count");
c = fresh("apparmor");
const nodes = [...new Set(c.podsOf("menu").map((p) => p.node))];
assert.ok(nodes.length >= 2, "menu spreads over more than one node");
step(c, "ssh worker-2 sudo apparmor_parser -q /etc/apparmor.d/k8s-deny-write");
assert.ok(!won(c) || !nodes.includes("worker-3"), "one more node is not every node");
step(c, "ssh worker-3 sudo apparmor_parser -q /etc/apparmor.d/k8s-deny-write");
assert.match(step(c, "ssh worker-3 sudo aa-status"), /k8s-deny-write/);
assert.ok(won(c), "apparmor: loaded on every node");

// Wrong targetPort: endpoints exist, nothing listens there.
c = fresh("svcport");
assert.match(step(c, "kubectl exec deploy/web -- wget -qO- -T 2 http://menu-svc"), /Connection refused/);
assert.match(step(c, "kubectl get endpoints menu-svc"), /:8080/);
assert.match(step(c, "kubectl describe svc menu-svc"), /TargetPort:\s+8080\/TCP/);
step(c, `kubectl patch svc menu-svc -p '{"spec":{"ports":[{"port":8080,"targetPort":8080}]}}'`);
assert.ok(!won(c), "moving the Service port does not move the app");
step(c, `kubectl patch svc menu-svc -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'`);
assert.match(step(c, "kubectl exec deploy/web -- wget -qO- -T 2 http://menu-svc"), /Welcome to nginx/);
assert.ok(won(c), "svcport: fixed by the right targetPort");

// CoreDNS down: names fail, IPs work.
c = fresh("coredns");
assert.match(step(c, "kubectl exec deploy/web -- wget -qO- -T 2 http://menu-svc"), /bad address/);
assert.match(step(c, "kubectl exec deploy/web -- wget -qO- -T 2 http://10.96.41.7"), /Welcome to nginx/);
assert.match(step(c, "kubectl exec deploy/web -- nslookup menu-svc"), /no servers could be reached/);
assert.match(step(c, "kubectl exec deploy/web -- cat /etc/resolv.conf"), /nameserver 10.96.0.10/);
assert.match(step(c, "kubectl -n kube-system get endpoints"), /kube-dns\s+<none>/);
assert.match(step(c, "kubectl -n kube-system get deploy"), /coredns\s+0\/0/);
step(c, "kubectl -n kube-system scale deployment coredns --replicas=1");
assert.match(step(c, "kubectl exec deploy/web -- nslookup menu-svc"), /Address:\s+10.96.41.7/);
assert.ok(!won(c), "one replica is one node failure away from the same outage");
step(c, "kubectl -n kube-system scale deployment coredns --replicas=2");
assert.ok(won(c), "coredns: scaled back to two");

// Private registry: credentials as a docker-registry Secret, referenced by the Pods.
c = fresh("pullsecret");
assert.match(step(c, "kubectl get pods"), /menu-\S+\s+0\/1\s+ImagePullBackOff/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "menu")), /401 Unauthorized/);
const token = step(c, "cat /opt/registry/kitchen-ci.token").trim();
step(c, "kubectl create secret docker-registry regcred --docker-server=registry.kitchen.example --docker-username=kitchen-ci --docker-password=wrong");
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"regcred"}]}}}}'`);
assert.ok(!won(c), "a wrong token is still 401");
c = fresh("pullsecret");
step(c, "kubectl set image deployment/menu menu=nginx:1.27");
assert.ok(!won(c), "switching to a public image does not count");
c = fresh("pullsecret");
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"regcred"}]}}}}'`);
assert.ok(!won(c));
assert.match(step(c, `kubectl create secret docker-registry regcred --docker-server=registry.kitchen.example --docker-username=kitchen-ci --docker-password=${token}`), /secret\/regcred created/);
assert.match(step(c, "kubectl get secrets"), /regcred\s+kubernetes.io\/dockerconfigjson/);
assert.ok(won(c), "pullsecret: the kubelet retries once the secret exists");
c = fresh("pullsecret");
step(c, `kubectl create secret docker-registry regcred --docker-server=registry.kitchen.example --docker-username=kitchen-ci --docker-password=${token}`);
assert.match(step(c, `kubectl patch serviceaccount default -p '{"imagePullSecrets":[{"name":"regcred"}]}'`), /new Pods get these/);
assert.ok(!won(c), "existing Pods keep the pull secrets they started with");
step(c, "kubectl rollout restart deployment/menu");
assert.ok(won(c), "pullsecret: fixed through the ServiceAccount and a restart");

// ConfigMap not reloaded: env is read at start.
c = fresh("cmreload");
assert.match(step(c, "kubectl get configmap orders-config -o yaml"), /autumn.json/);
assert.match(step(c, "kubectl logs deployment/orders"), /summer.json/);
assert.match(step(c, "kubectl exec deploy/orders -- env"), /MENU_FILE=\/etc\/menu\/summer.json/);
step(c, `kubectl delete pod ${podOf(c, "orders")}`);
assert.ok(!won(c), "one replaced Pod is not every Pod");
step(c, "kubectl rollout restart deployment/orders");
assert.match(step(c, "kubectl logs deployment/orders"), /autumn.json/);
assert.ok(won(c), "cmreload: fixed by a rollout restart");

// Scheduler down: Pending with no events at all.
c = fresh("scheduler");
assert.match(step(c, "kubectl get pods"), /web-\S+\s+1\/1\s+Running/);
assert.match(step(c, "kubectl get pods"), /menu-\S+\s+0\/1\s+Pending/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "menu")), /Events:\s+<none>/);
assert.match(step(c, "kubectl -n kube-system get pods"), /kube-scheduler-control-plane\s+0\/1\s+CrashLoopBackOff/);
assert.match(step(c, "kubectl -n kube-system logs kube-scheduler-control-plane"), /scheduler.config: no such file/);
assert.match(step(c, "ls /etc/kubernetes"), /scheduler.conf/);
step(c, `kubectl delete pod ${podOf(c, "menu")}`);
assert.ok(!won(c), "a new Pod waits for the same scheduler");
step(c, "sed -i 's#scheduler.config#scheduler.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml");
assert.match(step(c, "kubectl get pods"), /menu-\S+\s+1\/1\s+Running/, "editing the scheduler does not take the API server down");
assert.match(step(c, "kubectl -n kube-system get pods"), /kube-scheduler-control-plane\s+1\/1\s+Running/);
assert.ok(won(c), "scheduler: fixed in its static Pod manifest");

// Missing Secret key: the reference, not the value, is wrong.
c = fresh("secretkey");
assert.match(step(c, "kubectl get pods"), /payments-\S+\s+0\/1\s+CreateContainerConfigError/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "payments")), /couldn't find key password in Secret kitchen\/db-credentials/);
assert.match(step(c, "kubectl describe secret db-credentials"), /db-password:\s+18 bytes/);
step(c, "kubectl set env deployment/payments DB_PASSWORD=practice-only-pass");
assert.ok(c.deploymentReady("payments") && !won(c), "a plain value in the Deployment does not count");
c = fresh("secretkey");
step(c, `kubectl patch deployment payments -p '{"spec":{"template":{"spec":{"containers":[{"name":"payments","env":[{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"name":"db-credential","key":"db-password"}}}]}]}}}}'`);
assert.match(step(c, "kubectl describe pod " + podOf(c, "payments")), /secret "db-credential" not found/);
step(c, `kubectl patch deployment payments -p '{"spec":{"template":{"spec":{"containers":[{"name":"payments","env":[{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"name":"db-credentials","key":"db-password"}}}]}]}}}}'`);
assert.match(step(c, "kubectl get deploy payments -o yaml"), /key: db-password/);
assert.ok(won(c), "secretkey: fixed by referencing the key that exists");

// Ingress TLS: the fake certificate means no usable Secret.
c = fresh("ingresstls");
assert.match(step(c, "curl -s http://menu.kitchen.example/"), /Welcome to nginx/);
assert.match(step(c, "curl https://menu.kitchen.example/"), /self-signed certificate/);
assert.match(step(c, "curl -v https://menu.kitchen.example/"), /CN=Kubernetes Ingress Controller Fake Certificate/);
assert.match(step(c, "kubectl -n ingress-nginx logs deploy/ingress-nginx-controller"), /Using default certificate/);
assert.match(step(c, "curl -k https://menu.kitchen.example/"), /Welcome to nginx/);
assert.ok(!won(c), "-k only skips the check");
step(c, "kubectl create secret generic menu-tls --from-literal=tls.crt=x");
assert.match(step(c, "kubectl -n ingress-nginx logs deploy/ingress-nginx-controller"), /not of type kubernetes.io\/tls/);
step(c, "kubectl delete secret menu-tls");
assert.match(step(c, "kubectl create secret tls menu-tls --cert=/opt/certs/menu.kitchen.example.crt --key=/opt/certs/staging-wildcard.key"), /does not match/);
step(c, "kubectl create secret tls menu-tls --cert=/opt/certs/staging-wildcard.crt --key=/opt/certs/staging-wildcard.key");
assert.match(step(c, "curl https://menu.kitchen.example/"), /no alternative certificate subject name matches/);
assert.ok(!won(c), "a certificate for another name does not count");
step(c, "kubectl delete secret menu-tls");
assert.match(step(c, "kubectl create secret tls menu-tls --cert=/opt/certs/menu.kitchen.example.crt --key=/opt/certs/menu.kitchen.example.key"), /secret\/menu-tls created/);
assert.match(step(c, "kubectl get secrets"), /menu-tls\s+kubernetes.io\/tls/);
assert.match(step(c, "curl -v https://menu.kitchen.example/"), /CN=menu.kitchen.example[\s\S]*Welcome to nginx/);
assert.ok(won(c), "ingresstls: fixed with a TLS Secret for the host");

// Stuck Terminating: a finalizer nobody removes.
c = fresh("finalizer");
assert.match(step(c, "kubectl get pods"), /report-runner\s+0\/1\s+Terminating/);
assert.match(step(c, "kubectl get pod report-runner -o yaml"), /deletionTimestamp[\s\S]*finalizers:\n  - kitchen.example\/archive-logs/);
assert.match(step(c, "kubectl delete pod report-runner"), /wait/);
assert.match(step(c, "kubectl delete pod report-runner --force --grace-period=0"), /force deleted/);
assert.match(step(c, "kubectl get pods"), /report-runner\s+0\/1\s+Terminating/);
assert.ok(!won(c), "--force does not remove finalizers");
step(c, `kubectl patch pod report-runner -p '{"metadata":{"finalizers":null}}'`);
assert.doesNotMatch(step(c, "kubectl get pods"), /report-runner/);
assert.ok(won(c), "finalizer: removed by hand");

// Certificates expired: renew, restart the static Pods, refresh the kubeconfig.
c = fresh("certs");
assert.match(step(c, "kubectl get nodes"), /x509: certificate has expired/);
assert.match(step(c, "kubeadm certs check-expiration"), /apiserver\s+Oct 30, 2026 07:42 UTC\s+<invalid>/);
assert.match(step(c, "openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate"), /notAfter=Oct 30 07:42:10 2026/);
step(c, "mv /etc/kubernetes/manifests/*.yaml /tmp/");
step(c, "mv /tmp/*.yaml /etc/kubernetes/manifests/");
assert.match(step(c, "kubectl get nodes"), /x509|refused/, "restarting before renewing changes nothing");
assert.match(step(c, "kubeadm certs renew all"), /You must restart the kube-apiserver/);
assert.match(step(c, "kubectl get nodes"), /x509/, "the API server still holds the old certificate");
step(c, "mv /etc/kubernetes/manifests/*.yaml /tmp/");
assert.match(step(c, "ls /etc/kubernetes/manifests"), /\(empty\)/);
assert.match(step(c, "kubectl get nodes"), /refused/);
step(c, "mv /tmp/*.yaml /etc/kubernetes/manifests/");
step(c, "kubectl get nodes");
assert.match(step(c, "kubectl get nodes"), /You must be logged in/);
assert.ok(!won(c), "the kubeconfig still has the old client certificate");
assert.match(step(c, "kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes"), /worker-1\s+Ready/);
step(c, "cp /etc/kubernetes/admin.conf ~/.kube/config");
assert.match(step(c, "kubectl get nodes"), /worker-1\s+Ready/);
assert.match(step(c, "kubeadm certs check-expiration"), /apiserver\s+Oct 30, 2027 09:20 UTC\s+364d/);
assert.ok(won(c), "certs: renewed, restarted, kubeconfig refreshed");
c = fresh("certs");
step(c, "kubeadm certs renew all");
step(c, "mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/");
step(c, "mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/");
step(c, "kubectl get nodes");
step(c, "export KUBECONFIG=/etc/kubernetes/admin.conf");
assert.match(step(c, "kubectl get nodes"), /worker-1\s+Ready/);
assert.ok(!won(c), "etcd, the scheduler and the controller manager still run on the old certificates");

// Wrong command: StartError, exit 128, empty logs.
c = fresh("cmdtypo");
assert.match(step(c, "kubectl get pods"), /menu-\S+\s+0\/1\s+CrashLoopBackOff/);
assert.match(step(c, "kubectl logs deployment/menu"), /never started/);
const cmdPod = step(c, "kubectl describe pod " + podOf(c, "menu"));
assert.match(cmdPod, /Reason:\s+StartError[\s\S]*Exit Code:\s+128/);
assert.match(cmdPod, /exec: "ngnix": executable file not found in \$PATH/);
step(c, "kubectl rollout restart deployment/menu");
assert.ok(!won(c), "a restart runs the same command");
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","command":["nginx","-g","daemon off;"]}]}}}}'`);
assert.ok(won(c), "cmdtypo: fixed command");
c = fresh("cmdtypo");
step(c, `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","command":null}]}}}}'`);
assert.ok(won(c), "cmdtypo: the image's own command works too");

// Slow start: liveness kills it before it has loaded.
c = fresh("startup");
assert.match(step(c, "kubectl get pods"), /ledger-\S+\s+0\/1\s+CrashLoopBackOff/);
assert.match(step(c, "kubectl logs deployment/ledger --previous"), /SIGTERM while loading/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "ledger")), /Liveness probe failed[\s\S]*failed liveness probe, will be restarted/);
step(c, `kubectl patch deployment ledger -p '{"spec":{"template":{"spec":{"containers":[{"name":"ledger","livenessProbe":{"failureThreshold":5}}]}}}}'`);
assert.ok(!won(c), "10s + 5 x 10s is still shorter than 90s");
step(c, `kubectl patch deployment ledger -p '{"spec":{"template":{"spec":{"containers":[{"name":"ledger","livenessProbe":null}]}}}}'`);
assert.ok(c.deploymentReady("ledger") && !won(c), "dropping liveness starts it, but does not count");
c = fresh("startup");
step(c, `kubectl patch deployment ledger -p '{"spec":{"template":{"spec":{"containers":[{"name":"ledger","startupProbe":{"httpGet":{"path":"/healthz","port":8080},"periodSeconds":10,"failureThreshold":30}}]}}}}'`);
assert.match(step(c, "kubectl get deploy ledger -o yaml"), /startupProbe:[\s\S]*failureThreshold: 30/);
assert.ok(won(c), "startup: a startupProbe gives it time");
c = fresh("startup");
step(c, `kubectl patch deployment ledger -p '{"spec":{"template":{"spec":{"containers":[{"name":"ledger","livenessProbe":{"initialDelaySeconds":120}}]}}}}'`);
assert.ok(won(c), "startup: a long initialDelaySeconds also works");

// Wrong architecture: exec format error.
c = fresh("arch");
assert.match(step(c, "kubectl logs deployment/invoice"), /exec format error/);
assert.match(step(c, "kubectl get nodes -L kubernetes.io/arch"), /worker-1.*amd64/);
assert.match(step(c, "docker buildx imagetools inspect localhost:5000/invoice:2.0-arm64"), /linux\/arm64\s+\(a single-architecture image\)/);
assert.match(step(c, "curl http://localhost:5000/v2/invoice/tags/list"), /"2.0"/);
assert.match(step(c, "docker buildx imagetools inspect localhost:5000/invoice:2.0"), /linux\/amd64[\s\S]*linux\/arm64/);
step(c, `kubectl patch deployment invoice -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/arch":"arm64"}}}}}'`);
assert.ok(!won(c), "there are no arm64 nodes");
c = fresh("arch");
step(c, "kubectl set image deployment/invoice invoice=localhost:5000/invoice:2.0");
assert.ok(won(c), "arch: multi-arch tag");

// Multi-Attach: RWO volume and a rolling update.
c = fresh("multiattach");
const ma = step(c, "kubectl get pods -o wide");
assert.match(ma, /uploads-\S+\s+1\/1\s+Running/);
assert.match(ma, /uploads-\S+\s+0\/1\s+ContainerCreating/);
const newUp = c.podsOf("uploads").find((p) => !p.old);
assert.match(step(c, "kubectl describe pod " + newUp.name), /Multi-Attach error for volume/);
step(c, `kubectl delete pod ${newUp.name}`);
assert.ok(!won(c), "a new Pod hits the same volume");
assert.match(step(c, `kubectl patch deployment uploads -p '{"spec":{"strategy":{"type":"Recreate"}}}'`), /may not be specified/);
step(c, `kubectl patch deployment uploads -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}'`);
assert.match(step(c, "kubectl describe deployment uploads"), /StrategyType:\s+Recreate/);
assert.ok(won(c), "multiattach: Recreate lets the volume move");

// Canary leaking: a Service selects every Pod with its labels.
c = fresh("canary");
const calls = [1, 2, 3].map(() => step(c, "kubectl exec deploy/api -- wget -qO- -T 2 http://menu-svc")).join("\n");
assert.match(calls, /Welcome to nginx/);
assert.match(calls, /Connection refused/);
assert.match(step(c, "kubectl get pods --show-labels"), /menu-beta-\S+.*app=menu,track=beta/);
step(c, "kubectl scale deployment/menu-beta --replicas=0");
assert.ok(!won(c), "stopping the beta is not the fix");
c = fresh("canary");
step(c, "kubectl set selector service menu-svc app=menu,track=stable");
assert.match(step(c, "kubectl describe svc menu-svc"), /Selector:\s+app=menu,track=stable/);
assert.ok([1, 2, 3, 4].every(() => /Welcome to nginx/.test(step(c, "kubectl exec deploy/api -- wget -qO- -T 2 http://menu-svc"))));
assert.match(step(c, "kubectl exec deploy/api -- wget -qO- -T 2 http://menu-beta-svc"), /menu \(beta\)/);
assert.ok(won(c), "canary: the stable Service selects the stable track");

// DaemonSet missing a node: DESIRED already excludes the tainted node.
c = fresh("daemonset");
assert.match(step(c, "kubectl get ds"), /log-agent\s+2\s+2\s+2/);
assert.doesNotMatch(step(c, "kubectl get pods -o wide"), /log-agent-\S+.*worker-3/);
step(c, "kubectl taint node worker-3 dedicated-");
assert.match(step(c, "kubectl get pods -o wide"), /log-agent-\S+.*worker-3/);
assert.ok(!won(c), "removing the taint opens the GPU node to everything");
c = fresh("daemonset");
const agent = c.pods.find((p) => p.ds === "log-agent");
assert.match(step(c, `kubectl delete pod ${agent.name}`), /creates a replacement/);
assert.strictEqual(c.pods.filter((p) => p.ds === "log-agent").length, 2);
step(c, `kubectl patch ds log-agent -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"dedicated","operator":"Exists","effect":"NoSchedule"}]}}}}'`);
assert.match(step(c, "kubectl get ds"), /log-agent\s+3\s+3\s+3/);
assert.ok(won(c), "daemonset: tolerates the GPU taint");

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
