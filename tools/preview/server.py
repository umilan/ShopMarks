#!/usr/bin/env python3
"""Serves the extension's dashboard on localhost for a quick look while editing.

    python3 tools/preview/server.py [port]

The extension files are served untouched; the dashboard and popup pages get shim.js added
in front of its scripts, which fakes chrome.storage and reloads on file changes.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXTENSION = HERE.parent.parent / "extension"
DASHBOARD = "/src/dashboard.html"
# Pages that get the shim; the popup is shown inside the dashboard as a preview.
PAGES = {DASHBOARD, "/src/popup.html"}
SHIM_TAG = '<script src="/__preview/shim.js"></script>\n  '


def version():
    return str(max(p.stat().st_mtime_ns for p in [*EXTENSION.rglob("*"), HERE / "shim.js"] if p.is_file()))


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            self.send_response(302)
            self.send_header("Location", DASHBOARD)
            self.end_headers()
        elif path == "/__preview/version":
            self.reply(version().encode(), "text/plain")
        elif path == "/__preview/shim.js":
            self.reply((HERE / "shim.js").read_bytes(), "text/javascript")
        elif path in PAGES:
            html = (EXTENSION / path.lstrip("/")).read_text(encoding="utf-8")
            self.reply(html.replace("<script", SHIM_TAG + "<script", 1).encode(), "text/html; charset=utf-8")
        else:
            super().do_GET()

    def reply(self, body, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(EXTENSION)))
    print(f"Saver dashboard preview: http://localhost:{port}/")
    server.serve_forever()
