"""The extension access token — an HMAC envelope, not a JWT.

Format, unchanged and unchangeable:

    base64url(JSON{policyId,userId,exp}) + "." + base64url(HMAC-SHA256(payload, secret))

Tokens already issued live inside browser extensions with a thirty-day expiry, so the
format, the field names, the signing input and the secret must all stay exactly as they
are through the cutover. Nothing here is a design choice; it is a description.

The one thing that *is* a choice: the secret is read from ``CF_EXTENSION_TOKEN_SECRET``
falling back to ``JWT_SECRET``. Today one secret signs both session cookies and these
tokens, which means rotating either one invalidates the other — including every installed
extension. The fallback keeps existing tokens verifying while making independent rotation
possible for the first time.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Final

TOKEN_TTL_S: Final = 60 * 60 * 24 * 30


@dataclass(frozen=True, slots=True)
class ExtensionClaims:
    policy_id: int
    user_id: int
    expires_at: int

    @property
    def expired(self) -> bool:
        return self.expires_at * 1000 <= time.time() * 1000


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _signature(payload: str, secret: str) -> str:
    return _b64url_encode(hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), sha256).digest())


def mint_extension_token(*, policy_id: int, user_id: int, secret: str, now: float | None = None) -> tuple[str, int]:
    """Issue a token and its expiry. Returns ``(token, expires_at_epoch_seconds)``."""
    expires_at = int((now if now is not None else time.time()) + TOKEN_TTL_S)
    payload = _b64url_encode(
        json.dumps(
            {"policyId": policy_id, "userId": user_id, "exp": expires_at},
            separators=(",", ":"),
        ).encode("utf-8")
    )
    return f"{payload}.{_signature(payload, secret)}", expires_at


def verify_extension_token(token: str, secret: str, now: float | None = None) -> ExtensionClaims | None:
    """Return the claims, or ``None`` for anything that does not verify.

    ``None`` rather than an exception because every failure mode — forged, tampered,
    expired, malformed, unconfigured secret — produces the same answer to the caller, and
    distinguishing them in the response would tell an attacker which part they got right.

    An empty secret makes every token fail. That is deliberate: a server with no secret
    configured must reject tokens rather than accept unsigned ones.
    """
    if not secret or not token or token.count(".") != 1:
        return None
    payload, provided = token.split(".", 1)
    expected = _signature(payload, secret)
    # Constant-time: a byte-by-byte comparison leaks how much of a forged signature was
    # correct, which is enough to construct one.
    if not hmac.compare_digest(expected, provided):
        return None

    try:
        claims = json.loads(_b64url_decode(payload))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict):
        return None

    policy_id, user_id, expires_at = claims.get("policyId"), claims.get("userId"), claims.get("exp")
    if not all(isinstance(value, int) and not isinstance(value, bool) for value in (policy_id, user_id, expires_at)):
        return None
    if expires_at * 1000 <= (now if now is not None else time.time()) * 1000:
        return None
    return ExtensionClaims(policy_id=policy_id, user_id=user_id, expires_at=expires_at)


def read_bearer(header: str | None) -> str:
    """Strip a ``Bearer`` prefix, case-insensitively, as the Node server did."""
    if not header:
        return ""
    value = header.strip()
    if value[:7].lower() == "bearer ":
        return value[7:].strip()
    return value
