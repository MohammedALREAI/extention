"""The model route ladder. Ported from server/modelRouter.test.ts.

The ladder *is* the retry strategy: each attempt runs against a different model with its
own short timeout, rather than backing off against a host that is not coming back. These
tests pin that, plus the configuration escape hatch that makes a provider outage a
one-variable fix instead of a deploy.
"""

import json

import httpx
import pytest

from contentfirewall.adapters.model.gateway import (
    CIRCUIT_COOLDOWN_S,
    MODEL_ROUTES,
    CircuitBreaker,
    GatewayError,
    HttpModelGateway,
    matches_prefix,
    ordered_models,
    route_prefixes,
)
from contentfirewall.domain.errors import DomainError
from contentfirewall.domain.ports import ModelCall

CATALOG = [
    "google/gemini-3.8-flash",
    "google/gemini-3-flash-preview",
    "openai/gpt-4o-2024-11-20",
    "anthropic/claude-sonnet-5",
    "qwen/qwen3-vl-32b-instruct",
]


def gateway(handler, **kwargs) -> HttpModelGateway:
    return HttpModelGateway(
        base_url="https://gateway.test",
        api_key="k",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        **kwargs,
    )


def catalog_response() -> httpx.Response:
    return httpx.Response(200, json={"data": [{"id": model} for model in CATALOG]})


def completion(text: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


def call(route: str = "visual") -> ModelCall:
    return ModelCall(route=route, prompt="p")


class TestPrefixResolution:
    def test_matches_a_vendor_namespaced_catalog(self) -> None:
        # "qwen/qwen3-vl-32b-instruct" must match the prefix "qwen3-vl", which a plain
        # startswith on the full id would miss entirely.
        assert matches_prefix("qwen/qwen3-vl-32b-instruct", "qwen3-vl") is True
        assert matches_prefix("qwen/qwen3-vl-32b-instruct", "qwen/qwen3") is True
        assert matches_prefix("openai/gpt-4o-2024-11-20", "gpt-4o") is True
        assert matches_prefix("openai/gpt-4o-2024-11-20", "claude") is False

    def test_resolves_in_preference_order(self) -> None:
        assert ordered_models(CATALOG, ["gpt-4o", "gemini-3.8"]) == [
            "openai/gpt-4o-2024-11-20",
            "google/gemini-3.8-flash",
        ]

    def test_two_prefixes_resolving_to_one_model_give_one_attempt(self) -> None:
        # The route needs two distinct attempts, not the same model asked twice.
        assert ordered_models(CATALOG, ["gpt-4o", "openai/gpt-4o"]) == ["openai/gpt-4o-2024-11-20"]

    def test_an_unmatched_prefix_is_skipped_rather_than_failing(self) -> None:
        assert ordered_models(CATALOG, ["nonexistent", "gpt-4o"]) == ["openai/gpt-4o-2024-11-20"]


class TestRouteConfiguration:
    def test_falls_back_to_the_built_in_order_when_unset(self) -> None:
        assert route_prefixes("visual", {}) == MODEL_ROUTES["visual"].preferred_prefixes

    def test_the_environment_overrides_the_built_in_order(self) -> None:
        # This was a real bug: the adapter ignored CF_MODEL_VISUAL and always used its
        # built-in list, so the configured model was never tried and every request paid a
        # wasted failing attempt first.
        assert route_prefixes("visual", {"CF_MODEL_VISUAL": "qwen3-vl, gpt-4o"}) == ("qwen3-vl", "gpt-4o")

    def test_blank_and_whitespace_entries_are_ignored(self) -> None:
        assert route_prefixes("visual", {"CF_MODEL_VISUAL": " a ,, b ,  "}) == ("a", "b")
        assert route_prefixes("visual", {"CF_MODEL_VISUAL": "   "}) == MODEL_ROUTES["visual"].preferred_prefixes

    def test_the_visual_budget_fits_inside_the_extension_deadline(self) -> None:
        # Three attempts at 6s must fit under the 20s abort compiled into installed
        # extensions. Raising either number here needs a change nobody can make there.
        route = MODEL_ROUTES["visual"]
        assert route.max_attempts * route.timeout_s <= 20.0


def requested_model(request: httpx.Request) -> str:
    return json.loads(request.read())["model"]


class TestLadder:
    async def test_uses_the_first_healthy_model(self) -> None:
        used: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/models"):
                return catalog_response()
            used.append(requested_model(request))
            return completion("ok")

        answer = await gateway(handler, prefixes_for=lambda route: ["gemini-3.8"]).invoke(call())
        assert answer.model == "google/gemini-3.8-flash"
        assert answer.attempts == 1
        assert used == ["google/gemini-3.8-flash"]

    async def test_moves_to_the_next_model_when_one_fails(self) -> None:
        attempted: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/models"):
                return catalog_response()
            model = requested_model(request)
            attempted.append(model)
            if model == "google/gemini-3.8-flash":
                return httpx.Response(503)
            return completion("ok")

        answer = await gateway(handler, prefixes_for=lambda route: ["gemini-3.8", "gpt-4o"]).invoke(call())
        assert answer.model == "openai/gpt-4o-2024-11-20"
        assert answer.attempts == 2
        assert attempted == ["google/gemini-3.8-flash", "openai/gpt-4o-2024-11-20"]

    async def test_stops_after_the_routes_attempt_limit(self) -> None:
        attempted: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/models"):
                return catalog_response()
            attempted.append(requested_model(request))
            return httpx.Response(500)

        # Four prefixes offered, but the route caps attempts at three — the cap is what
        # keeps the worst case inside the extension's deadline.
        prefixes = ["gemini-3.8", "gpt-4o", "claude-sonnet", "qwen3-vl"]
        with pytest.raises(GatewayError, match="failed after"):
            await gateway(handler, prefixes_for=lambda route: prefixes).invoke(call())
        assert len(attempted) == MODEL_ROUTES["visual"].max_attempts == 3
        assert len(set(attempted)) == 3, "each attempt must use a different model"

    async def test_names_the_variable_to_set_when_nothing_matches(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return catalog_response() if request.url.path.endswith("/models") else completion("ok")

        with pytest.raises(GatewayError, match="CF_MODEL_VISUAL"):
            await gateway(handler, prefixes_for=lambda route: ["no-such-model"]).invoke(call())

    async def test_names_the_variables_to_check_when_the_catalog_is_unreachable(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401)

        with pytest.raises(GatewayError, match="BUILT_IN_FORGE_API_URL"):
            await gateway(handler).invoke(call())


class TestCatalogCache:
    async def test_fetches_the_catalog_once_across_many_calls(self) -> None:
        fetches = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal fetches
            if request.url.path.endswith("/models"):
                fetches += 1
                return catalog_response()
            return completion("ok")

        client = gateway(handler, prefixes_for=lambda route: ["gemini-3.8"])
        for _ in range(3):
            await client.invoke(call())
        assert fetches == 1


class TestCircuitBreaker:
    def test_opens_after_two_consecutive_failures(self) -> None:
        clock = [0.0]
        breaker = CircuitBreaker(now=lambda: clock[0])

        breaker.record_failure("m")
        assert breaker.is_open("m") is False  # one failure is not a pattern
        breaker.record_failure("m")
        assert breaker.is_open("m") is True

        clock[0] += CIRCUIT_COOLDOWN_S + 1
        assert breaker.is_open("m") is False  # and it lets the model back in

    def test_a_success_resets_the_count_entirely(self) -> None:
        breaker = CircuitBreaker(now=lambda: 0.0)
        breaker.record_failure("m")
        breaker.record_success("m")
        breaker.record_failure("m")
        assert breaker.is_open("m") is False

    async def test_an_unusable_answer_moves_the_ladder_to_the_next_model(self) -> None:
        # The bug this pins, found by running the server against a live provider: parsing
        # happened *after* the ladder, so a model returning empty content counted as a
        # success and the next model was never tried. One provider quirk became a failed
        # request, where the ladder exists precisely to absorb it.
        attempted: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/models"):
                return catalog_response()
            model = requested_model(request)
            attempted.append(model)
            # First model answers with nothing at all, as a real one did.
            return completion("" if model == "google/gemini-3.8-flash" else '{"ok":true}')

        def parse(content: object) -> dict:
            import json as _json

            if not content:
                raise DomainError("empty content")
            return _json.loads(str(content))

        client = gateway(handler, prefixes_for=lambda route: ["gemini-3.8", "gpt-4o"])
        answer = await client.invoke(ModelCall(route="visual", prompt="p", parse=parse))

        assert answer.value == {"ok": True}
        assert answer.model == "openai/gpt-4o-2024-11-20"
        assert answer.attempts == 2
        assert len(attempted) == 2

    async def test_a_ladder_where_every_answer_is_unusable_fails(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return catalog_response() if request.url.path.endswith("/models") else completion("")

        def parse(content: object) -> object:
            if not content:
                raise DomainError("empty content")
            return content

        client = gateway(handler, prefixes_for=lambda route: ["gemini-3.8", "gpt-4o"])
        with pytest.raises(GatewayError, match="failed after"):
            await client.invoke(ModelCall(route="visual", prompt="p", parse=parse))

    async def test_an_unparseable_answer_counts_against_the_model(self) -> None:
        # A model that reliably returns garbage is as broken as one that times out, and the
        # ladder should stop asking it the same question.
        def handler(request: httpx.Request) -> httpx.Response:
            return catalog_response() if request.url.path.endswith("/models") else completion("{}")

        client = gateway(handler, prefixes_for=lambda route: ["gemini-3.8"])
        answer = await client.invoke(call())
        client.record_unusable_answer(answer.model)
        client.record_unusable_answer(answer.model)

        with pytest.raises(GatewayError, match="cooldown"):
            await client.invoke(call())


class TestBudget:
    async def test_never_exceeds_the_callers_remaining_budget(self) -> None:
        seen: list[float | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/models"):
                return catalog_response()
            seen.append(request.extensions.get("timeout", {}).get("read"))
            return completion("ok")

        await gateway(handler, prefixes_for=lambda route: ["gemini-3.8"]).invoke(call(), timeout=1.5)
        assert seen[0] == 1.5  # the route's own 6s ceiling loses to the tighter budget

    async def test_does_not_start_an_attempt_with_no_budget_left(self) -> None:
        attempted = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempted
            if request.url.path.endswith("/models"):
                return catalog_response()
            attempted += 1
            return completion("ok")

        with pytest.raises(GatewayError):
            await gateway(handler, prefixes_for=lambda route: ["gemini-3.8"]).invoke(call(), timeout=0)
        assert attempted == 0
