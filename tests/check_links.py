#!/usr/bin/env python3
"""Fail if a Markdown file links to a repository path that does not exist.

Checks relative links in every tracked .md file, including image sources.
External links (http, https, mailto) and same-page anchors are skipped.
Run with: python3 tests/check_links.py
"""

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
MD_LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_SRC = re.compile(r"""(?:src|href)="([^"]+)\"""")
CODE_FENCE = re.compile(r"^```.*?^```", re.S | re.M)
INLINE_CODE = re.compile(r"`[^`\n]*`")


def targets(text):
    text = CODE_FENCE.sub("", text)
    text = INLINE_CODE.sub("", text)
    yield from MD_LINK.findall(text)
    yield from HTML_SRC.findall(text)


def main():
    files = subprocess.check_output(["git", "ls-files", "*.md"], cwd=ROOT, text=True).split()
    broken = []
    for name in files:
        path = ROOT / name
        for target in targets(path.read_text(encoding="utf-8")):
            if re.match(r"^(https?:|mailto:|#)", target):
                continue
            rel = unquote(target.split("#", 1)[0])
            if not rel:
                continue
            if not (path.parent / rel).exists():
                broken.append(f"{name}: {target}")
    if broken:
        print("Broken links:\n  " + "\n  ".join(broken))
        return 1
    print(f"links ok: {len(files)} Markdown files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
