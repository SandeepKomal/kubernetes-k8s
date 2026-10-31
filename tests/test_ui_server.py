"""Tests for the practice dashboard server (labs/ui/server.py).

Run with: python3 -m unittest discover -s tests
"""

import http.client
import json
import sys
import threading
import unittest
from unittest import mock
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "labs" / "ui"))
import server  # noqa: E402


class KubectlArgsTest(unittest.TestCase):
    def test_adds_level_namespace_before_the_command(self):
        self.assertEqual(server.kubectl_args("get pods", "nimbus-05"), ["-n", "nimbus-05", "get", "pods"])

    def test_namespace_never_lands_after_double_dash(self):
        args = server.kubectl_args("exec web -- cat /etc/hostname", "nimbus-05")
        self.assertEqual(args[:2], ["-n", "nimbus-05"])
        self.assertEqual(args[-3:], ["--", "cat", "/etc/hostname"])

    def test_keeps_an_explicit_namespace(self):
        self.assertEqual(server.kubectl_args("get pods -A", "q"), ["get", "pods", "-A"])
        self.assertEqual(server.kubectl_args("get pods --namespace=x", "q"), ["get", "pods", "--namespace=x"])

    def test_strips_a_leading_kubectl(self):
        self.assertEqual(server.kubectl_args("kubectl get svc", "q"), ["-n", "q", "get", "svc"])

    def test_refuses_other_clusters_and_identities(self):
        for line in ["get pods --context prod", "get pods --context=prod", "get pods --kubeconfig /x",
                     "get pods -s https://evil", "get pods --server=https://evil", "get pods --as=admin",
                     "get pods --token=abc", "get pods --as-group=system:masters"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")

    def test_refuses_local_file_writes(self):
        for line in ["cp web:/etc/passwd /tmp/x", "cluster-info dump --output-directory=/tmp/x",
                     "get pods --log-file=/tmp/x", "get pods --log-dir /tmp"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")

    def test_refuses_interactive_and_blocking_commands(self):
        for line in ["config view", "edit deploy web", "proxy", "port-forward svc/web 8080:80", "attach web"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")

    def test_refuses_flags_with_attached_values(self):
        # kubectl reads -shttps://host as --server=https://host.
        for line in ["get pods -shttps://evil", "get pods -s=https://evil", "apply -f/etc/passwd"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")

    def test_refuses_local_file_reads(self):
        for line in ["apply -f /etc/passwd", "create -f ~/.ssh/id_rsa", "apply -k .", "get -f x.yaml",
                     "create secret generic x --from-file=/root/.kube/config", "create configmap x --from-env-file .env",
                     "logs -f web"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")

    def test_refuses_unknown_commands_that_could_be_plugins(self):
        for line in ["evil-plugin", "krew install x", "foo get pods"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")

    def test_container_commands_keep_their_own_flags(self):
        args = server.kubectl_args("exec web -- curl -s -f http://api", "q")
        self.assertEqual(args[-4:], ["curl", "-s", "-f", "http://api"])

    def test_requires_the_command_first(self):
        # Otherwise "-n x config view" would hide `config` behind a flag value.
        with self.assertRaises(ValueError):
            server.kubectl_args("-n x config view", "q")

    def test_refuses_shell_syntax(self):
        for line in ["get pods | grep x", "get pods > /tmp/x", "get pods ; rm -rf /", "get pods && id"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")

    def test_rejects_empty_and_unparseable_input(self):
        for line in ["", "   ", "kubectl", "get 'pods"]:
            with self.subTest(line=line), self.assertRaises(ValueError):
                server.kubectl_args(line, "q")


class HttpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.Handler.token = "test-token"
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def request(self, method, path, token=None, body=None, content_type="application/json"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {}
        if token:
            headers["X-Nimbus-Token"] = token
        if body is not None:
            headers["Content-Type"] = content_type
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp, data

    def test_static_page_is_served_with_a_strict_csp(self):
        resp, data = self.request("GET", "/")
        self.assertEqual(resp.status, 200)
        self.assertIn(b"DevOps Nimbus Kubernetes", data)
        csp = resp.getheader("Content-Security-Policy")
        self.assertIn("default-src 'self'", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertEqual(resp.getheader("X-Content-Type-Options"), "nosniff")

    def test_logo_is_served_as_svg(self):
        resp, data = self.request("GET", "/logo.svg")
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.getheader("Content-Type"), "image/svg+xml")
        self.assertIn(b"<svg", data)

    def test_api_needs_the_token(self):
        for method, path in [("GET", "/api/levels"), ("GET", "/api/levels/00"),
                             ("POST", "/api/levels/00/start"), ("POST", "/api/levels/00/kubectl")]:
            with self.subTest(path=path):
                resp, _ = self.request(method, path)
                self.assertEqual(resp.status, 403)
                resp, _ = self.request(method, path, token="wrong")
                self.assertEqual(resp.status, 403)

    def test_levels_are_listed_with_the_token(self):
        resp, data = self.request("GET", "/api/levels", token="test-token")
        self.assertEqual(resp.status, 200)
        levels = json.loads(data)["levels"]
        dirs = sorted(p.name for p in server.LEVELS.iterdir() if p.is_dir() and p.name[:2].isdigit())
        self.assertEqual([lv["slug"] for lv in levels], dirs)

    def test_level_readme_is_returned(self):
        resp, data = self.request("GET", "/api/levels/00", token="test-token")
        self.assertEqual(resp.status, 200)
        self.assertTrue(json.loads(data)["readme"].startswith("# Level 00"))

    def test_unknown_levels_and_actions_are_rejected(self):
        for method, path in [("GET", "/api/levels/99"), ("GET", "/api/levels/../etc"),
                             ("POST", "/api/levels/00/solve"), ("POST", "/api/levels/00;id/check"),
                             ("POST", "/api/levels/0/check")]:
            with self.subTest(path=path):
                resp, _ = self.request(method, path, token="test-token")
                self.assertEqual(resp.status, 404)

    def test_unknown_static_paths_are_not_served(self):
        for path in ["/server.py", "/../../nimbus", "/index.html.bak"]:
            with self.subTest(path=path):
                resp, _ = self.request("GET", path)
                self.assertEqual(resp.status, 404)

    def test_console_requires_json(self):
        resp, data = self.request("POST", "/api/levels/00/kubectl", token="test-token",
                                  body="command=get pods", content_type="application/x-www-form-urlencoded")
        result = json.loads(data)
        self.assertFalse(result["ok"])

    def test_large_bodies_are_refused(self):
        big = json.dumps({"yaml": "x" * (server.MAX_BODY + 10)})
        resp, data = self.request("POST", "/api/levels/00/apply", token="test-token", body=big)
        self.assertFalse(json.loads(data)["ok"])

    def test_malformed_bodies_get_an_answer(self):
        # A JSON array, or a negative length, once dropped the connection without a response.
        with mock.patch.object(server, "practice_context", return_value="kind-k8s-nimbus"):
            resp, data = self.request("POST", "/api/levels/00/kubectl", token="test-token", body="[]")
            self.assertEqual(resp.status, 200)
            self.assertIn("JSON object", json.loads(data)["output"])
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            conn.putrequest("POST", "/api/levels/00/kubectl")
            for k, v in {"X-Nimbus-Token": "test-token", "Content-Type": "application/json", "Content-Length": "-1"}.items():
                conn.putheader(k, v)
            conn.endheaders()
            resp = conn.getresponse()
            self.assertIn("Content-Length", json.loads(resp.read())["output"])
            conn.close()


if __name__ == "__main__":
    unittest.main()
