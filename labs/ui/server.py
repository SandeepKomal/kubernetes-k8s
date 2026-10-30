#!/usr/bin/env python3
"""Local practice dashboard for Kubernetes Quest.

Serves a small web page that shows each level's mission and lets the learner
start a level, run its checks, read hints and watch the namespace, by calling
the ./quest script. Standard library only.

Security model:
  * listens on 127.0.0.1 only;
  * every API call needs the random token printed at start-up, so other web
    pages open in the same browser cannot drive it (CSRF, DNS rebinding);
  * level arguments are validated, and only fixed ./quest sub-commands and a
    read-only `kubectl get` are ever run.
"""

import argparse
import json
import os
import re
import secrets
import subprocess
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LEVELS = ROOT / "labs"
QUEST = ROOT / "quest"
STATE_DIR = Path(os.environ.get("QUEST_HOME", Path.home() / ".k8s-quest"))
ANSI = re.compile(r"\x1b\[[0-9;]*m")
LEVEL_ID = re.compile(r"^[0-9]{2}$")
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}
# Long enough for a level whose setup waits for a rollout.
COMMAND_TIMEOUT = 300


def level_dirs():
    return sorted(p for p in LEVELS.iterdir() if p.is_dir() and re.match(r"^[0-9]{2}-", p.name))


def find_level(level_id):
    if not LEVEL_ID.match(level_id or ""):
        return None
    for d in level_dirs():
        if d.name.startswith(level_id + "-"):
            return d
    return None


def read_state(name):
    try:
        return (STATE_DIR / name).read_text().split()
    except OSError:
        return []


def run(args, timeout=COMMAND_TIMEOUT):
    """Run a command, returning (exit code, output without colour codes)."""
    try:
        proc = subprocess.run(
            args, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, timeout=timeout,
        )
        return proc.returncode, ANSI.sub("", proc.stdout)
    except subprocess.TimeoutExpired:
        return 124, f"Timed out after {timeout} seconds."
    except OSError as err:
        return 127, str(err)


def parse_checks(output):
    checks = []
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("✔ "):
            checks.append({"ok": True, "text": line[2:]})
        elif line.startswith("✘ "):
            checks.append({"ok": False, "text": line[2:]})
    return checks


class Handler(BaseHTTPRequestHandler):
    token = ""
    server_version = "k8s-quest-ui"

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorised(self):
        given = self.headers.get("X-Quest-Token", "")
        if secrets.compare_digest(given, self.token):
            return True
        self.send_json({"error": "missing or wrong token; open the URL printed by ./quest ui"}, HTTPStatus.FORBIDDEN)
        return False

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in STATIC:
            name, ctype = STATIC[path]
            body = (HERE / name).read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
            return
        if not path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self.authorised():
            return
        if path == "/api/levels":
            done = set(read_state("done"))
            current = (read_state("current") or [""])[0]
            levels = []
            for d in level_dirs():
                lid = d.name[:2]
                title = (d / "README.md").read_text().splitlines()[0].lstrip("# ").strip()
                levels.append({"id": lid, "slug": d.name, "title": title, "done": lid in done})
            _, ctx = run(["kubectl", "config", "current-context"], timeout=10)
            self.send_json({"levels": levels, "current": current, "context": ctx.strip()})
            return
        m = re.match(r"^/api/levels/([0-9]{2})(/state)?$", path)
        level = find_level(m.group(1)) if m else None
        if not level:
            self.send_json({"error": "no such level"}, HTTPStatus.NOT_FOUND)
            return
        if m.group(2):
            ns = "quest-" + level.name[:2]
            code, out = run(["kubectl", "get", "deploy,rs,pods,svc,pvc,jobs,cronjobs,netpol,hpa",
                             "-n", ns, "-o", "wide"], timeout=20)
            self.send_json({"ok": code == 0, "output": out.strip() or "No resources yet."})
            return
        self.send_json({"id": level.name[:2], "readme": (level / "README.md").read_text()})

    def do_POST(self):
        if not self.authorised():
            return
        m = re.match(r"^/api/levels/([0-9]{2})/(start|check|hint|solution)$", self.path)
        level = find_level(m.group(1)) if m else None
        if not level:
            self.send_json({"error": "no such level or action"}, HTTPStatus.NOT_FOUND)
            return
        action = m.group(2)
        code, out = run([str(QUEST), action, str(int(level.name[:2]))])
        result = {"ok": code == 0, "output": out.strip()}
        if action == "check":
            result["checks"] = parse_checks(out)
        self.send_json(result)


def main():
    parser = argparse.ArgumentParser(description="Kubernetes Quest practice dashboard")
    parser.add_argument("--port", type=int, default=int(os.environ.get("QUEST_UI_PORT", "8765")))
    args = parser.parse_args()

    Handler.token = secrets.token_urlsafe(24)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as err:
        sys.exit(f"error: cannot listen on 127.0.0.1:{args.port} ({err}). Try --port 8766")
    base = f"http://127.0.0.1:{args.port}"
    codespace = os.environ.get("CODESPACE_NAME")
    domain = os.environ.get("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN")
    if codespace and domain:
        # In GitHub Codespaces the browser reaches the port through GitHub's forwarder.
        base = f"https://{codespace}-{args.port}.{domain}"
    print("Kubernetes Quest dashboard")
    print(f"  Open: {base}/#token={Handler.token}")
    print("  Keep your terminal for kubectl. Press Ctrl+C here to stop the dashboard.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
