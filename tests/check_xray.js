// Checks the YAML X-ray explainer: every line of the repository's own
// manifests gets a note, known fields are explained, and risky values warn.
// Run with: node tests/check_xray.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

require(path.resolve(__dirname, "../site/xray-explain.js"));
const { explain } = globalThis.KQExplain;
const root = path.resolve(__dirname, "..");

const sample = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: menu   # the app
  labels:
    app: menu
spec:
  replicas: 2
  selector:
    matchLabels:
      app: menu
  template:
    metadata:
      labels:
        app: menu
    spec:
      containers:
      - name: web
        image: nginx:latest
        ports:
        - containerPort: 80
        env:
        - name: GREETING
          value: "hi: there"
        command:
        - sh
        args: ["-c", "echo hi"]
        resources:
          limits:
            memory: 128Mi
        securityContext:
          privileged: true
---
apiVersion: v1
kind: Service
metadata:
  name: menu
spec:
  selector:
    app: menu
  ports:
  - port: 80
    targetPort: 80
`;
const r = explain(sample);
const at = (text) => r.lines.find((l) => l.line.trim().startsWith(text));
assert.match(at("replicas:").note, /How many Pods/);
assert.match(at("- name: web").note, /Container name/);
assert.match(at("image:").warns.join(" "), /:latest/);
assert.match(at("- containerPort").note, /listens on/);
assert.match(at("- name: GREETING").note, /variable's name/);
assert.match(at('value: "hi: there"').note, /literal value/);
assert.match(at("- sh").note, /One argument/);
assert.match(at("memory: 128Mi").note, /binary units/);
assert.match(at("privileged: true").warns.join(" "), /take over the node/);
assert.match(at("---").note, /new object/);
assert.match(at("targetPort").note, /port on the Pod/);
assert.match(r.lines.filter((l) => l.line.trim().startsWith("selector:"))[1].note, /Ready Pods carrying/);
assert.ok(r.review.some((n) => /no resource requests/.test(n)), "review: missing requests");
assert.ok(r.review.some((n) => /no readinessProbe/.test(n)), "review: missing readiness");
assert.ok(!r.review.some((n) => /no memory limit/.test(n)), "review: the limit is set");

const pod = explain("apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: c\n      image: busybox\n      volumeMounts:\n        - name: data\n          mountPath: /data\n  volumes:\n    - name: data\n      emptyDir: {}\n");
assert.match(pod.lines.find((l) => /image: busybox/.test(l.line)).warns[0], /No tag/);
assert.match(pod.lines.find((l) => /mountPath/.test(l.line)).note, /directory inside the container/);
assert.match(pod.lines.find((l) => /emptyDir/.test(l.line)).note, /scratch directory/);

const block = explain("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\ndata:\n  nginx.conf: |\n    server {\n      listen 80;\n    }\n  mode: fast\n");
assert.strictEqual(block.lines[6].level, "cont");
assert.match(block.lines[9].note, /One key/);

assert.match(explain("x".repeat(2) + "\n".repeat(500)).error, /up to 400 lines/);
assert.strictEqual(explain("foo: bar").lines[0].level, "unknown");

// Every manifest in the repository: no crash, every non-blank line has a note,
// and most lines are known to the dictionary.
let files = 0;
let total = 0;
let unknown = 0;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ya?ml$/.test(e.name) ? [path.join(dir, e.name)] : []);
for (const f of [...walk(path.join(root, "reference")), ...walk(path.join(root, "labs")), ...walk(path.join(root, "examples"))]) {
  const res = explain(fs.readFileSync(f, "utf8"));
  if (res.error) continue;
  files++;
  for (const l of res.lines) {
    if (l.level === "blank") continue;
    assert.ok(l.note, `${path.relative(root, f)}: no note for "${l.line}"`);
    total++;
    if (l.level === "unknown") unknown++;
  }
}
const known = 1 - unknown / total;
assert.ok(known > 0.95, `only ${(known * 100).toFixed(1)}% of manifest lines are explained`);
console.log(`xray ok: ${files} manifests, ${total} lines, ${(known * 100).toFixed(1)}% explained`);
