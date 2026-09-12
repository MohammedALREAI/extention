"""What an extension request resolved to — the outcome, not its HTTP rendering.

The refusal reasons live here rather than in the API layer because the service decides
*which* one applies; the API layer only decides how to say it. Keeping the two apart is
what lets the auth ladder be tested without a web framework, and what stops a status code
from leaking into a query.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from contentfirewall.domain.models import FirewallRule


class Refusal(StrEnum):
    """Why a request may not proceed.

    Five distinct reasons, not one, because the extension shows the user a different
    message for each and decides differently whether to retry. Collapsing them into a
    generic failure hides a fixable problem behind "try again later".
    """

    # S105 reads any constant whose name contains TOKEN as a hardcoded credential. This is
    # the name of a failure, not a secret.
    INVALID_TOKEN = "invalid_token"  # noqa: S105
    UNKNOWN_USER = "unknown_user"
    ACCESS_ENDED = "access_ended"
    RATE_LIMITED = "rate_limited"
    POLICY_NOT_FOUND = "policy_not_found"


@dataclass(frozen=True, slots=True)
class ResolvedPolicy:
    """Either the policy to check against, or the reason there isn't one."""

    source_preference: str = ""
    rules: list[FirewallRule] = field(default_factory=list)
    refusal: Refusal | None = None

    @property
    def allowed(self) -> bool:
        return self.refusal is None
