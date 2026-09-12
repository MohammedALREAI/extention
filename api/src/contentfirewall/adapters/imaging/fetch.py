"""Fetching an image by a URL a *web page* supplied — the SSRF surface.

The URL comes from whatever page the extension is running on, so it is attacker-influenced
by definition. A page can hand over ``https://internal.corp/admin`` or a host that resolves
to ``169.254.169.254``, the cloud metadata endpoint that turns SSRF into credential theft.

Four rules, all load-bearing:

* HTTPS only;
* **resolve the name and judge every address before connecting** — checking the hostname
  string proves nothing, since DNS decides where the socket actually goes;
* re-check on **every** redirect hop, because a permitted host may redirect to a forbidden
  address;
* count bytes while streaming, so a server that lies about ``content-length`` still cannot
  fill memory.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from typing import Final

import httpx

from contentfirewall.domain.ports import FetchedImage

logger: Final = logging.getLogger(__name__)

MAX_REMOTE_IMAGE_BYTES: Final = 6 * 1024 * 1024
REMOTE_IMAGE_TIMEOUT_S: Final = 4.0
MAX_REDIRECTS: Final = 3

# A bare client sends no User-Agent, and large CDNs answer that with a 4xx — which read as
# "unreachable" and quietly sent the model a URL instead of pixels. JPEG and PNG are listed
# first on purpose: a CDN offered AVIF answers with AVIF, which is slower to decode and the
# format most likely to be missing from a libvips build.
REQUEST_HEADERS: Final = {
    "user-agent": "Mozilla/5.0 (compatible; ContentFirewall/1.0; +https://github.com/content-firewall)",
    "accept": "image/jpeg,image/png,image/webp,image/*;q=0.8",
}


def is_blocked_address(address: str) -> bool:
    """True for anything a page must not be able to reach through us.

    Anything that is not a parseable IP is blocked, so a failure to understand an address
    is never a reason to connect to it.
    """
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return True

    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return is_blocked_address(str(ip.ipv4_mapped))
        if ip.sixtofour is not None:
            return is_blocked_address(str(ip.sixtofour))

    # Covers loopback, link-local (169.254.0.0/16 — the metadata endpoint), every private
    # range, multicast and reserved space, in both families.
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True
    # Carrier-grade NAT: routable-looking, but someone else's internal network.
    return ip in ipaddress.ip_network("100.64.0.0/10") if ip.version == 4 else False


async def resolves_to_allowed_address(hostname: str) -> bool:
    """Resolve and judge every address the name maps to, before any socket is opened."""
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        return not is_blocked_address(hostname)

    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            hostname, None, proto=socket.IPPROTO_TCP
        )
    except (OSError, socket.gaierror):
        return False
    addresses = {info[4][0] for info in infos}
    # Every address, not any: a name that resolves to one public and one private address
    # would otherwise be a way straight through this check.
    return bool(addresses) and not any(is_blocked_address(address) for address in addresses)


class GuardedImageFetcher:
    """Satisfies the domain's ``ImageFetcher`` protocol, safely."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(
            follow_redirects=False,  # every hop is inspected by hand
            timeout=httpx.Timeout(REMOTE_IMAGE_TIMEOUT_S),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def fetch(self, url: str) -> FetchedImage | None:
        target = url
        for _ in range(MAX_REDIRECTS + 1):
            parsed = httpx.URL(target)
            if parsed.scheme != "https":
                return None
            host = parsed.host
            if not host or not await resolves_to_allowed_address(host):
                logger.info("image fetch blocked", extra={"host": host})
                return None

            try:
                async with self._client.stream("GET", target, headers=REQUEST_HEADERS) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            return None
                        target = str(parsed.join(location))
                        continue
                    if response.status_code >= 400:
                        return None

                    mime = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    if not mime.startswith("image/"):
                        return None

                    declared = response.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > MAX_REMOTE_IMAGE_BYTES:
                        return None

                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        # Counted while streaming: a server that lies about its
                        # content-length must still be stopped before it fills memory.
                        if total > MAX_REMOTE_IMAGE_BYTES:
                            return None
                        chunks.append(chunk)
            except (httpx.HTTPError, ValueError):
                return None

            data = b"".join(chunks)
            return FetchedImage(data=data, mime=mime) if data else None
        return None
