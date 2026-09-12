"""The SSRF guard. Ported from server/imageFetch.test.ts.

The URL comes from whatever page the extension is running on, so it is attacker-influenced
by definition. These tests are the reason a page cannot use this server as a proxy into the
network it runs on.
"""

import httpx
import pytest

from contentfirewall.adapters.imaging.fetch import (
    MAX_REMOTE_IMAGE_BYTES,
    REQUEST_HEADERS,
    GuardedImageFetcher,
    is_blocked_address,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24


class TestBlockedAddresses:
    @pytest.mark.parametrize(
        "address",
        [
            "169.254.169.254",  # the cloud metadata endpoint — SSRF into credential theft
            "127.0.0.1",
            "127.1.2.3",
            "0.0.0.0",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "100.64.0.1",  # carrier-grade NAT: routable-looking, someone else's network
            "100.127.255.255",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd00::1",
            "::ffff:10.0.0.1",  # IPv4 mapped into IPv6
            "::ffff:127.0.0.1",
            "2002:a00:1::",  # 6to4 wrapping 10.0.0.1
            "not-an-ip",
            "",
        ],
    )
    def test_blocks_everything_that_reaches_inside(self, address: str) -> None:
        assert is_blocked_address(address) is True

    @pytest.mark.parametrize(
        "address", ["93.184.216.34", "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "2606:4700::1111"]
    )
    def test_allows_ordinary_public_addresses(self, address: str) -> None:
        assert is_blocked_address(address) is False

    def test_an_unparseable_address_is_blocked_not_allowed(self) -> None:
        # Failing to understand an address is never a reason to connect to it.
        assert is_blocked_address("10.0.0.1 ") is True
        assert is_blocked_address("999.999.999.999") is True


def transport(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)


def image_response(data: bytes = PNG, **headers: str) -> httpx.Response:
    return httpx.Response(200, content=data, headers={"content-type": "image/png", **headers})


class TestFetching:
    async def test_refuses_plain_http(self) -> None:
        fetcher = GuardedImageFetcher(transport(lambda request: image_response()))
        assert await fetcher.fetch("http://93.184.216.34/dog.png") is None

    async def test_refuses_a_literal_private_address_without_connecting(self) -> None:
        connected = False

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal connected
            connected = True
            return image_response()

        fetcher = GuardedImageFetcher(transport(handler))
        assert await fetcher.fetch("https://169.254.169.254/latest/meta-data/") is None
        assert connected is False, "the guard must run before any socket is opened"

    async def test_returns_the_bytes_for_an_ordinary_public_image(self) -> None:
        fetcher = GuardedImageFetcher(transport(lambda request: image_response()))
        result = await fetcher.fetch("https://93.184.216.34/dog.png")
        assert result is not None
        assert result.data == PNG
        assert result.mime == "image/png"

    async def test_identifies_itself(self) -> None:
        # A bare client sends no User-Agent, and large CDNs answer that with a 4xx — which
        # read as "unreachable" and quietly sent the model a URL instead of pixels.
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return image_response()

        await GuardedImageFetcher(transport(handler)).fetch("https://93.184.216.34/dog.png")
        assert "ContentFirewall" in seen[0].headers["user-agent"]
        assert "image/" in seen[0].headers["accept"]
        assert REQUEST_HEADERS["accept"].startswith("image/jpeg")  # JPEG before AVIF, deliberately

    async def test_refuses_a_response_that_is_not_an_image(self) -> None:
        fetcher = GuardedImageFetcher(
            transport(lambda request: httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"}))
        )
        assert await fetcher.fetch("https://93.184.216.34/page") is None

    async def test_refuses_an_error_response(self) -> None:
        fetcher = GuardedImageFetcher(transport(lambda request: httpx.Response(404)))
        assert await fetcher.fetch("https://93.184.216.34/missing.png") is None


class TestRedirects:
    async def test_rechecks_the_address_after_a_redirect(self) -> None:
        # A permitted host redirecting to a forbidden address is the whole reason every hop
        # is inspected rather than letting the client follow redirects itself.
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "93.184.216.34":
                return httpx.Response(302, headers={"location": "https://169.254.169.254/meta"})
            return image_response()

        fetcher = GuardedImageFetcher(transport(handler))
        assert await fetcher.fetch("https://93.184.216.34/redirect") is None

    async def test_follows_a_redirect_to_another_public_host(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/redirect":
                return httpx.Response(302, headers={"location": "https://8.8.8.8/final.png"})
            return image_response()

        result = await GuardedImageFetcher(transport(handler)).fetch("https://93.184.216.34/redirect")
        assert result is not None

    async def test_gives_up_after_too_many_hops(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "https://93.184.216.34/again"})

        assert await GuardedImageFetcher(transport(handler)).fetch("https://93.184.216.34/loop") is None

    async def test_a_redirect_without_a_location_stops(self) -> None:
        fetcher = GuardedImageFetcher(transport(lambda request: httpx.Response(302)))
        assert await fetcher.fetch("https://93.184.216.34/x.png") is None


class TestSizeCap:
    async def test_refuses_a_declared_length_over_the_cap(self) -> None:
        oversized = str(MAX_REMOTE_IMAGE_BYTES + 1)

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, content=PNG, headers={"content-type": "image/png", "content-length": oversized}
            )

        assert await GuardedImageFetcher(transport(handler)).fetch("https://93.184.216.34/huge.png") is None

    async def test_aborts_a_body_that_grows_past_the_cap_even_when_the_header_lied(self) -> None:
        # Counted while streaming: a server that lies about content-length must still be
        # stopped before it fills memory.
        sent = 0

        async def stream():
            nonlocal sent
            for _ in range(20):
                sent += 1
                yield b"\x00" * 1_000_000

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, content=stream(), headers={"content-type": "image/png", "content-length": "10"}
            )

        assert await GuardedImageFetcher(transport(handler)).fetch("https://93.184.216.34/liar.png") is None
        # Stopped partway rather than after buffering all 20 MB.
        assert sent <= MAX_REMOTE_IMAGE_BYTES // 1_000_000 + 2

    async def test_an_empty_body_is_not_an_image(self) -> None:
        fetcher = GuardedImageFetcher(transport(lambda request: image_response(data=b"")))
        assert await fetcher.fetch("https://93.184.216.34/empty.png") is None
