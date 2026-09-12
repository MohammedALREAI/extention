"""Run the Python detection pipeline against a real image and print what it found.

Use the project virtualenv, which is where the dependencies live:

    api\\.venv\\Scripts\\python.exe api/scripts/demo_detect.py --term cat     (Windows)
    api/.venv/bin/python api/scripts/demo_detect.py --term dog --url https://...

This is the end-to-end proof that the ported domain works against a live model, not just
against recorded fixtures: real gateway, real image fetch, real libvips, real boxes.

It reports the pass count, because the cost argument is the whole design — an easy image
should cost one model call and an uncertain one two.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from contentfirewall.adapters.imaging.fetch import GuardedImageFetcher
from contentfirewall.adapters.imaging.vips import ImagingUnavailableError, VipsImageOps
from contentfirewall.adapters.model.gateway import HttpModelGateway
from contentfirewall.domain.deadline import Deadline
from contentfirewall.domain.models import FirewallRule, PipelineImage, PolicyAction
from contentfirewall.domain.ports import ModelAnswer, ModelCall
from contentfirewall.domain.visual_pipeline import PipelineRequest, detect_images
from contentfirewall.settings import settings

DEFAULT_URL = "https://images.pexels.com/photos/45201/kitty-cat-kitten-pet-45201.jpeg?auto=compress&cs=tinysrgb&w=640"
EXTENSION_BUDGET_S = 15.0


class CountingGateway:
    """Wraps the real gateway to report what the pipeline actually spent."""

    def __init__(self, inner: HttpModelGateway) -> None:
        self.inner = inner
        self.calls: list[tuple[str, int, int, float]] = []

    async def invoke(self, call: ModelCall, *, timeout: float | None = None) -> ModelAnswer:  # noqa: ASYNC109
        started = time.monotonic()
        answer = await self.inner.invoke(call, timeout=timeout)
        # `attempts` is what the route ladder actually spent. Reporting only the successful
        # model would hide a first-choice provider that is quietly failing every request.
        self.calls.append((answer.model, answer.attempts, len(call.images), time.monotonic() - started))
        return answer


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--term", default="cat", help="the blocked term to look for")
    parser.add_argument("--url", default=DEFAULT_URL, help="image to inspect")
    parser.add_argument("--effort", default="thorough", choices=["fast", "thorough"])
    args = parser.parse_args()

    try:
        settings.require_gateway()
    except RuntimeError as error:
        print(f"FAILED: {error}")
        return 1

    try:
        ops = VipsImageOps()
    except ImagingUnavailableError as error:
        # Refusing here rather than limping on: without imaging the run still produces
        # boxes, by handing the model a URL instead of pixels — which is the degraded path
        # this whole adapter exists to avoid, and it would look like success.
        print(f"\nFAILED: {error}\n")
        return 1

    gateway = HttpModelGateway(base_url=settings.gateway_url, api_key=settings.gateway_key)
    counting = CountingGateway(gateway)
    fetcher = GuardedImageFetcher()

    # One finally for every exit path: a leaked ProcessPoolExecutor keeps the interpreter
    # alive on Windows, so an early return would hang the command rather than end it.
    try:
        print(f"\npython    {sys.executable}")
        print(f"gateway   {settings.gateway_url}")
        try:
            resolved = await gateway.models_for("visual")
            print(f"visual    {', '.join(resolved) or 'NO MATCH'}")
        except Exception as error:
            print(f"FAILED to read the model catalog: {error}")
            return 1

        print(f"blocking  {args.term}")
        print(f"image     {args.url[:88]}")
        print(f"effort    {args.effort}\n")

        started = time.monotonic()
        try:
            detections = await detect_images(
                PipelineRequest(
                    source_preference=f"Do not show me: {args.term}",
                    rules=[FirewallRule(term=args.term, action=PolicyAction.BLUR)],
                    images=[PipelineImage(id="demo", url=args.url)],
                    effort=args.effort,
                ),
                model=counting,
                fetcher=fetcher,
                ops=ops,
                deadline=Deadline.after(EXTENSION_BUDGET_S),
            )
        except Exception as error:
            print(f"FAILED: {type(error).__name__}: {error}")
            return 1
    finally:
        await gateway.aclose()
        await fetcher.aclose()
        ops.close()

    elapsed = time.monotonic() - started
    attempts = 0
    for index, (model, tries, images, duration) in enumerate(counting.calls, start=1):
        attempts += tries
        ladder = "" if tries == 1 else f", {tries - 1} earlier model(s) failed"
        print(f"  pass {index}: {model}  ({images} image(s), {duration:.1f}s{ladder})")
    print(f"\n  total {elapsed:.1f}s — {len(counting.calls)} pass(es), {attempts} upstream attempt(s)"
          f", budget was {EXTENSION_BUDGET_S:.0f}s\n")

    for detection in detections:
        if detection.unavailable:
            print(f"  {detection.id}: UNAVAILABLE (could not inspect — not a no-match)")
            continue
        if not detection.boxes:
            print(f"  {detection.id}: no {args.term} found")
            continue
        print(f"  {detection.id}: {len(detection.boxes)} box(es)")
        for box in detection.boxes:
            area = box.area / 10_000
            print(
                f"      {box.label:<16} conf {box.confidence:.2f}  "
                f"at ({box.x:.0f},{box.y:.0f}) {box.width:.0f}x{box.height:.0f}  "
                f"— {area:.1f}% of the frame"
            )
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
