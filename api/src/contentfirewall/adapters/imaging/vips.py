"""Pixel work, via libvips — the same engine ``sharp`` used, so geometry matches.

Every operation runs in a process pool, not a thread pool. libvips releases the GIL while
evaluating a pipeline, so threads *mostly* work — but the buffer copy out of the JPEG
writer is GIL-bound, and a libvips abort on a malformed file is fatal to the whole process.
In a pool, a corrupt image kills one worker and the request survives.

``VIPS_CONCURRENCY=1`` is set in each worker so libvips does not spawn its own thread farm
per process and oversubscribe the CPU. Parallelism then comes from the pool size, which is
one number to reason about instead of two that multiply.

Every method answers ``None`` on undecodable input rather than raising: one bad image must
degrade one detection, never fail the batch.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Final

from contentfirewall.domain.geometry import PixelRect
from contentfirewall.domain.ports import ImageInfo

logger: Final = logging.getLogger(__name__)

JPEG_QUALITY: Final = 82


def _init_worker() -> None:
    os.environ.setdefault("VIPS_CONCURRENCY", "1")
    os.environ.setdefault("VIPS_WARNING", "0")


# libvips signals "this is not an image I can read" through a wide family of exception
# types, so each of these catches broadly and reports it as "no result" rather than trying
# to enumerate them.


def _info_sync(data: bytes) -> tuple[int, int] | None:
    import pyvips

    try:
        image = pyvips.Image.new_from_buffer(data, "")
        return image.width, image.height
    except Exception:
        return None


def _resize_sync(data: bytes, width: int, height: int) -> bytes | None:
    import pyvips

    try:
        # thumbnail_buffer shrinks on load where the format allows it, which is
        # substantially faster than decoding at full size and then resizing.
        image = pyvips.Image.thumbnail_buffer(
            data, width, height=height, size="both", kernel="lanczos3"
        )
        return image.write_to_buffer(".jpg", Q=JPEG_QUALITY, strip=True)
    except Exception:
        return None


def _crop_sync(data: bytes, left: int, top: int, width: int, height: int) -> bytes | None:
    import pyvips

    try:
        image = pyvips.Image.new_from_buffer(data, "")
        # Clamped again here: this rectangle was computed from coordinates a model
        # produced, and libvips aborts the process rather than raising if it leaves the
        # image. The caller clamps too; belt and braces is cheap against a hard crash.
        left = max(0, min(left, image.width - 1))
        top = max(0, min(top, image.height - 1))
        width = max(1, min(width, image.width - left))
        height = max(1, min(height, image.height - top))
        return image.crop(left, top, width, height).write_to_buffer(
            ".jpg", Q=JPEG_QUALITY, strip=True
        )
    except Exception:
        return None


def _to_jpeg_sync(data: bytes, quality: int) -> bytes | None:
    import pyvips

    try:
        image = pyvips.Image.new_from_buffer(data, "")
        return image.write_to_buffer(".jpg", Q=quality, strip=True)
    except Exception:
        return None


class VipsImageOps:
    """Satisfies the domain's ``ImageOps`` protocol."""

    def __init__(self, max_workers: int | None = None) -> None:
        workers = max_workers or min(4, os.cpu_count() or 1)
        self._pool = ProcessPoolExecutor(max_workers=workers, initializer=_init_worker)

    def close(self) -> None:
        self._pool.shutdown(wait=True, cancel_futures=False)

    async def _run(self, function: Callable[..., Any], *args: Any) -> Any:
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(self._pool, function, *args)
        except Exception:
            # A pool worker that died takes its pending future with it. One image failing
            # is not a reason to fail the request that contained it.
            logger.warning("image operation failed", exc_info=True)
            return None

    async def info(self, data: bytes) -> ImageInfo | None:
        size = await self._run(_info_sync, data)
        return ImageInfo(width=size[0], height=size[1]) if size else None

    async def resize(self, data: bytes, width: int, height: int) -> bytes | None:
        return await self._run(_resize_sync, data, width, height)

    async def crop(self, data: bytes, rect: PixelRect) -> bytes | None:
        return await self._run(_crop_sync, data, rect.left, rect.top, rect.width, rect.height)

    async def to_jpeg(self, data: bytes, quality: int = JPEG_QUALITY) -> bytes | None:
        return await self._run(_to_jpeg_sync, data, quality)
