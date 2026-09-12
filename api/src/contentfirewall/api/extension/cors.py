"""CORS for the extension endpoints — hand-written, because the defaults are wrong here.

The content script runs on the search page, so the browser sends that page's origin. The
allow-list therefore has to name the search engines, and getting the pattern wrong is a
real vulnerability: an earlier version used ``google\\.[a-z.]+``, whose wildcard spanned
every remaining label, so ``https://www.google.com.evil.io`` matched and was reflected
back as an allowed origin.

Private Network Access is the other half. A page on a public origin reaching a loopback
address is a private-network request, so Chrome sends a preflight asking permission and
drops the real request unless the answer opts in. Without it the server sees nothing at
all and the extension reports the same "unavailable" it shows for a server that is down.
That opt-in is development-only: in a deployment it would invite any public page to reach
a server on someone's private network.
"""

from __future__ import annotations

import re
from typing import Final

# Capped at one optional 2-3 letter second-level label (co.uk, com.au) plus the TLD, so
# the wildcard cannot span into an attacker's domain.
SEARCH_ENGINE_ORIGIN: Final = re.compile(
    r"^https://(.*\.)?(google\.(?:[a-z]{2,3}\.)?[a-z]{2,}"
    r"|bing\.com|duckduckgo\.com|brave\.com|yahoo\.com|ecosia\.org)(:\d+)?$",
    re.IGNORECASE,
)
# Chrome extension ids are exactly 32 characters drawn from a-p.
EXTENSION_ORIGIN: Final = re.compile(r"^chrome-extension://[a-p]{32}$")
LOCAL_ORIGIN: Final = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")

ALLOWED_HEADERS: Final = "authorization, content-type"
ALLOWED_METHODS: Final = "POST, OPTIONS"


def is_allowed_origin(origin: str | None) -> bool:
    """An absent Origin is allowed: that is a server-to-server call, not a browser."""
    if not origin:
        return True
    return bool(
        EXTENSION_ORIGIN.match(origin) or LOCAL_ORIGIN.match(origin) or SEARCH_ENGINE_ORIGIN.match(origin)
    )


def cors_headers(
    origin: str | None,
    *,
    wants_private_network: bool = False,
    allow_private_network: bool = False,
) -> dict[str, str]:
    """The headers to attach to an allowed request. Empty dict means the origin is refused."""
    headers = {
        "access-control-allow-headers": ALLOWED_HEADERS,
        "access-control-allow-methods": ALLOWED_METHODS,
    }
    if origin:
        headers["access-control-allow-origin"] = origin
        # Without Vary, a shared cache can serve one origin's allowed response to another.
        headers["vary"] = "Origin"
    if wants_private_network and allow_private_network:
        headers["access-control-allow-private-network"] = "true"
    return headers
