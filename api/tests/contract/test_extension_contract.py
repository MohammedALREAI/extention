"""Replays the frozen extension contract recorded from the running TypeScript server.

The extension cannot be renegotiated: copies are installed in browsers nobody can
force-update, and they depend on exact status codes, a bare top-level array, exact CORS
headers, and ids echoed untouched.

Cases split in two. **Deterministic** ones — preflights, refused origins, validation
failures — are asserted exactly. **Model-dependent** ones vary between runs by nature, so
only the invariants that must never vary are asserted: the status class, the array shape,
and one entry per accepted id.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from asgi_lifespan import LifespanManager

from tests.fakes import FakeImageFetcher, FakeImageOps, FakeModelGateway

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "extension_golden.json"
GOLDEN = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = GOLDEN["cases"]

pytestmark = pytest.mark.contract


def deterministic(case: dict[str, Any]) -> bool:
    """True when the answer cannot depend on what a model happened to say that minute."""
    return case["request"]["method"] == "OPTIONS" or case["status"] in (400, 403)


DETERMINISTIC = [case for case in CASES if deterministic(case)]
MODEL_DEPENDENT = [case for case in CASES if not deterministic(case) and case["status"] == 200]


def case_id(case: dict[str, Any]) -> str:
    return case["name"]


@pytest.fixture
async def client(monkeypatch: pytest.MonkeyPatch):
    """The real app, with only the outbound edges faked."""
    monkeypatch.setenv("CF_DEV_NO_AUTH", "1")
    monkeypatch.setenv("CF_DEV_RULES", "cat")
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.setenv("CF_ENV", "development")

    from contentfirewall.main import create_app

    app = create_app()

    # Replace only what reaches the network. Everything the contract is about — routing,
    # CORS, normalisation, the response envelope — stays real.
    async def fake_lifespan_state() -> None:
        app.state.model = FakeModelGateway(replies=[])
        app.state.fetcher = FakeImageFetcher()
        app.state.ops = FakeImageOps()

    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.router.lifespan_context = _noop_lifespan(fake_lifespan_state)

    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            yield http, app


def _noop_lifespan(setup):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(app):
        await setup()
        yield

    return lifespan


async def replay(http: httpx.AsyncClient, case: dict[str, Any]) -> httpx.Response:
    request = case["request"]
    return await http.request(
        request["method"],
        request["url"],
        headers=request["headers"] or {},
        json=request["body"] if request["body"] is not None else None,
    )


class TestDeterministicCases:
    @pytest.mark.parametrize("case", DETERMINISTIC, ids=case_id)
    async def test_matches_the_typescript_server(self, client, case: dict[str, Any]) -> None:
        http, _ = client
        response = await replay(http, case)

        assert response.status_code == case["status"], case["name"]

        for header, expected in case["headers"].items():
            if header == "content-type":
                continue  # framing, not contract
            assert response.headers.get(header) == expected, f"{case['name']}: {header}"

        if isinstance(case["body"], dict) and "error" in case["body"]:
            assert response.json() == case["body"], case["name"]

    def test_the_corpus_covers_what_it_needs_to(self) -> None:
        names = {case["name"].lower() for case in DETERMINISTIC}
        assert any("evil.io" in name for name in names), "no lookalike-origin case"
        assert any("pna=true" in name for name in names), "no private-network preflight"
        assert sum(1 for case in DETERMINISTIC if case["status"] == 403) >= 10
        assert sum(1 for case in DETERMINISTIC if case["status"] == 400) >= 8


class TestPrivateNetworkAccess:
    async def test_grants_the_opt_in_only_when_asked(self, client) -> None:
        http, _ = client
        asked = await http.request(
            "OPTIONS",
            "/api/extension/visual-localize",
            headers={
                "origin": "https://www.google.com",
                "access-control-request-method": "POST",
                "access-control-request-private-network": "true",
            },
        )
        not_asked = await http.request(
            "OPTIONS",
            "/api/extension/visual-localize",
            headers={"origin": "https://www.google.com", "access-control-request-method": "POST"},
        )
        assert asked.headers.get("access-control-allow-private-network") == "true"
        assert not_asked.headers.get("access-control-allow-private-network") is None

    async def test_is_refused_in_production(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # In a deployment this header would invite any public page to reach a server on
        # someone's private network.
        monkeypatch.setenv("CF_ENV", "production")
        from contentfirewall.settings import Settings

        assert Settings().is_production is True


class TestResponseShape:
    async def test_success_is_a_bare_array_never_an_object(self, client) -> None:
        # visualClient.js fails the whole batch if the top-level value is not an array, and
        # marks every image unavailable. Wrapping the response is a silent outage.
        http, app = client
        app.state.model = FakeModelGateway(
            replies=[{"detections": [{"id": "a", "boxes": []}]}]
        )
        response = await http.post(
            "/api/extension/visual-localize",
            headers={"origin": "https://www.google.com", "authorization": "Bearer x"},
            json={"rules": ["cat"], "images": [{"id": "a", "url": "https://example.test/a.jpg"}]},
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    async def test_every_supplied_id_gets_exactly_one_entry(self, client) -> None:
        # An id the response omits is read as unavailable; an id it mangles is unmatchable.
        http, app = client
        long_id = "\U0001f600" * 60  # 120 UTF-16 code units: at the bound, accepted
        app.state.model = FakeModelGateway(replies=[{"detections": [{"id": long_id, "boxes": []}]}])
        response = await http.post(
            "/api/extension/visual-localize",
            headers={"origin": "https://www.google.com", "authorization": "Bearer x"},
            json={
                "rules": ["cat"],
                "images": [
                    {"id": long_id, "url": "https://example.test/a.jpg"},
                    {"id": "second", "url": "https://example.test/b.jpg"},
                ],
            },
        )
        body = response.json()
        assert [entry["id"] for entry in body] == [long_id, "second"]
        # The one the model never answered for must be unavailable, not an empty no-match.
        assert body[1]["status"] == "unavailable"

    async def test_a_model_failure_is_502_not_an_empty_success(self, client) -> None:
        # An empty array would read as "nothing matched" and leave the page unprotected.
        http, app = client
        app.state.model = FakeModelGateway(error=RuntimeError("gateway down"))
        response = await http.post(
            "/api/extension/visual-localize",
            headers={"origin": "https://www.google.com", "authorization": "Bearer x"},
            json={"rules": ["cat"], "images": [{"id": "a", "url": "https://example.test/a.jpg"}]},
        )
        assert response.status_code == 502
        assert response.json() == {"error": "Visual localization was unavailable."}


class TestIdEcho:
    async def test_semantic_returns_the_id_the_caller_sent(self, client) -> None:
        # The TypeScript server truncated an id to 80 characters to satisfy the model's
        # schema and then returned the *truncated* one, which the extension cannot match
        # against what it sent — and an unmatched decision is read as "allow". Bounding the
        # prompt and echoing the caller's id are two different jobs.
        http, app = client
        long_id = "y" * 90
        app.state.model = FakeModelGateway(
            replies=[{
                "evaluations": [{
                    "id": "r0",
                    "decision": "blur",
                    "confidence": 0.9,
                    "reason": "matched",
                    "matchedText": ["gambling"],
                }]
            }]
        )
        response = await http.post(
            "/api/extension/semantic-evaluate",
            headers={"origin": "https://www.google.com", "authorization": "Bearer x"},
            json={"rules": ["gambling"], "results": [{"id": long_id, "text": "a guide to gambling online"}]},
        )
        body = response.json()
        assert body[0]["id"] == long_id, "the caller's id must come back unchanged"
        assert body[0]["decision"] == "blur"

    async def test_an_id_the_model_invented_is_dropped(self, client) -> None:
        # An id we never sent cannot be matched to anything on the page, and acting on it
        # would apply a decision to a card nobody asked about. A short id is its own
        # surrogate — only one too long for the model's schema gets a positional stand-in.
        http, app = client
        app.state.model = FakeModelGateway(
            replies=[{
                "evaluations": [
                    {"id": "real", "decision": "allow", "confidence": 0.5, "reason": "fine", "matchedText": []},
                    {"id": "hallucinated", "decision": "block", "confidence": 0.9, "reason": "x", "matchedText": []},
                ]
            }]
        )
        response = await http.post(
            "/api/extension/semantic-evaluate",
            headers={"origin": "https://www.google.com", "authorization": "Bearer x"},
            json={"rules": ["gambling"], "results": [{"id": "real", "text": "a guide to gambling online"}]},
        )
        assert [entry["id"] for entry in response.json()] == ["real"]


class TestAuthBypassGating:
    async def test_without_the_bypass_every_request_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Until the database lands there is nothing to authenticate against, and answering
        # would mean checking against no policy at all — protection that is not protection.
        monkeypatch.delenv("CF_DEV_NO_AUTH", raising=False)
        monkeypatch.setenv("CF_ENV", "development")
        from contentfirewall.main import create_app

        app = create_app()
        app.state.model = FakeModelGateway(replies=[])
        app.state.fetcher = FakeImageFetcher()
        app.state.ops = FakeImageOps()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            response = await http.post(
                "/api/extension/visual-localize",
                headers={"origin": "https://www.google.com", "authorization": "Bearer forged"},
                json={"rules": ["cat"], "images": [{"id": "a", "url": "https://example.test/a.jpg"}]},
            )
        assert response.status_code == 401
        assert response.json() == {"error": "Invalid extension access token."}


class TestDeliberateDivergences:
    async def test_a_wrong_method_is_405_rather_than_an_html_page(self, client) -> None:
        # The Express catch-all answered GET on a POST endpoint with the SPA's HTML and a
        # 200. A client parsing that as JSON gets a confusing failure instead of a clear one.
        http, _ = client
        response = await http.get("/api/extension/visual-localize", headers={"origin": "https://www.google.com"})
        assert response.status_code == 405
        assert "text/html" not in response.headers.get("content-type", "")


class TestUnusableModelAnswer:
    async def test_becomes_502_not_an_empty_success(self, client) -> None:
        # An empty array would read to the extension as "nothing matched" and leave the
        # page unprotected. (That the *ladder* retries an unusable answer before giving up
        # is the gateway's job, and is pinned in tests/unit/test_model_gateway.py.)
        http, app = client
        app.state.model = FakeModelGateway(replies=[""])
        response = await http.post(
            "/api/extension/semantic-evaluate",
            headers={"origin": "https://www.google.com", "authorization": "Bearer x"},
            json={"rules": ["gambling"], "results": [{"id": "a", "text": "a guide to gambling online"}]},
        )
        assert response.status_code == 502
        assert response.json() == {"error": "Semantic evaluation was unavailable."}
