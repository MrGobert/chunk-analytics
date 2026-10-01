"""Where every Chunk broadcast goes: Resend's "Chunk Marketing" segment, from the marketing mailbox.

Chunk Marketing holds exactly the people who want marketing email. cerebral
keeps it in sync with each account's "Product Updates & Offers" switch and
every unsubscribe (services/marketing_email/consent.py). "General" holds every
account, including the ones that switched marketing off (James, 2026-10-01),
so a marketing broadcast must never target it.

The segment id lives in RESEND_MARKETING_SEGMENT_ID on cerebral, which owns
the sync. Scripts read it from the environment, else from cerebral's Heroku
config.
"""

import os
import subprocess

FROM_EMAIL = "Chunk AI <meetchunk@chunkapp.com>"
REPLY_TO = "meetchunk@chunkapp.com"
SEGMENT_NAME = "Chunk Marketing"
SEGMENT_ENV = "RESEND_MARKETING_SEGMENT_ID"
GENERAL_SEGMENT_ID = "bd174a71-cae1-4af4-8795-a3115d832819"


class BroadcastConfigError(RuntimeError):
    pass


def marketing_segment_id() -> str:
    """Chunk Marketing's id, from the environment or cerebral's Heroku config."""
    value = os.environ.get(SEGMENT_ENV, "").strip()
    if not value:
        try:
            result = subprocess.run(
                ["heroku", "config:get", SEGMENT_ENV, "--app", "cerebral"],
                capture_output=True, text=True, timeout=45,
            )
            value = result.stdout.strip() if result.returncode == 0 else ""
        except (OSError, subprocess.TimeoutExpired):
            value = ""
    if not value:
        raise BroadcastConfigError(
            f"{SEGMENT_ENV} is not set on cerebral. Find the segment's id with "
            "cerebral's `scripts/marketing_segment.py --create-segment` and set it there."
        )
    if value == GENERAL_SEGMENT_ID:
        raise BroadcastConfigError(
            f"{SEGMENT_ENV} points at General, which includes accounts that turned marketing off."
        )
    return value
