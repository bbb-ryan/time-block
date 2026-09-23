#!/usr/bin/env python3
"""Static file server for local dev that disables caching entirely.

Plain `python3 -m http.server` sends no Cache-Control header, so Chrome
heuristically caches JS/CSS independently of how the HTML page was loaded —
a hard-refresh on the page doesn't guarantee sub-resources are refetched.
This just adds Cache-Control: no-store to every response.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8743
    HTTPServer(("", port), NoCacheHandler).serve_forever()
