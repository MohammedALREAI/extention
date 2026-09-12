"""Imaging must fail loudly at construction, never quietly at runtime.

This exists because of an actual incident: running the demo with an interpreter that had
no libvips produced a traceback per image, fell back to sending the model a *URL* instead
of the pixels, found the object anyway, and reported success. The run looked fine.

That fallback is the exact path the imaging adapter exists to avoid — a host that refuses
the provider's fetch returns an empty result indistinguishable from "nothing matched",
leaving the image uncovered. A degradation nobody can see is worse than a startup failure
everybody can.
"""

import builtins
import sys

import pytest

from contentfirewall.adapters.imaging.vips import (
    ImagingUnavailableError,
    VipsImageOps,
    probe_imaging,
)


@pytest.fixture
def without_pyvips(monkeypatch: pytest.MonkeyPatch):
    real_import = builtins.__import__

    def fake_import(name: str, *args, **kwargs):
        if name == "pyvips":
            raise ModuleNotFoundError("No module named 'pyvips'")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "pyvips", raising=False)
    monkeypatch.setattr(builtins, "__import__", fake_import)


class TestProbe:
    def test_passes_when_libvips_is_present(self) -> None:
        probe_imaging()  # the suite's own environment must have it

    def test_raises_with_an_actionable_message_when_missing(self, without_pyvips) -> None:
        with pytest.raises(ImagingUnavailableError) as caught:
            probe_imaging()
        message = str(caught.value)
        assert sys.executable in message, "must name the interpreter that lacks it"
        assert "pyvips[binary]" in message, "must name the fix"
        assert ".venv" in message, "must point at the project virtualenv"


class TestConstruction:
    def test_refuses_to_build_without_libvips(self, without_pyvips) -> None:
        # Before any pool worker exists. Discovering this inside a subprocess turns one
        # configuration mistake into a traceback per image and a result that looks fine.
        with pytest.raises(ImagingUnavailableError):
            VipsImageOps()

    def test_builds_and_closes_cleanly_when_present(self) -> None:
        ops = VipsImageOps(max_workers=1)
        ops.close()
