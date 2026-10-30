// Drives the site's playground simulator without a browser: every scenario
// starts broken, wrong moves keep it broken, and the intended fix solves it.
// Run with: node tests/check_playground.js
"use strict";
const path = require("path");
const assert = require("assert");

require(path.resolve(__dirname, "../site/playground.js"));
const { SCENARIOS, Cluster, kubectl, tokenize, parseMem } = globalThis.KQSim;

const text = (c, cmd) => kubectl(c, cmd).map(([t]) => t).join("\n");
function step(c, cmd) {
  const out = text(c, cmd);
  c.settle();
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

// Errors stay errors.
c = fresh("crash");
assert.match(text(c, "kubectl describe pod nope"), /NotFound/);
assert.match(text(c, "kubectl get pods -n other"), /No resources found in other namespace/);
assert.match(text(c, "kubectl scale deployment/orders --replicas=99"), /0 to 6/);

console.log(`playground ok: ${SCENARIOS.length} scenarios`);
