"""Domain errors — no HTTP status codes, no framework types.

The API layer maps these onto status codes and response envelopes. Keeping the mapping
out of here is what lets the same domain code serve the frozen extension contract (flat
string errors), the frozen developer API (code+message) and the new SPA API (code,
message, details, requestId) without knowing any of them exist.
"""

from __future__ import annotations


class DomainError(Exception):
    """Base for every expected failure inside the domain."""


class ModelReplyError(DomainError):
    """The model answered, but not in the shape the prompt demanded.

    Distinct from a transport failure on purpose: the model router treats this as a
    failure of *that model* and trips its circuit, because a model that reliably returns
    unparseable JSON is as broken as one that times out.
    """


class ImageUnavailableError(DomainError):
    """The image itself could not be inspected — never a statement about its contents."""
