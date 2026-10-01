"""Where every Chunk broadcast goes: Resend's "Marketing" segment, from the marketing mailbox.

The Marketing segment holds exactly the people who want marketing email.
cerebral keeps it in sync with each account's "Product Updates & Offers"
switch and every unsubscribe (services/marketing_email/consent.py). The old
"General" segment stopped growing in Nov 2025 and ignores both, so no
broadcast may target it again.

The segment id lives in RESEND_MARKETING_SEGMENT_ID (set on cerebral and
cerebral-analytics when the segment was created). Scripts read it from the
environment, else from cerebral-analytics' Heroku config.
"""

import os
import subprocess

FROM_EMAIL = "Chunk AI <meetchunk@chunkapp.com>"
REPLY_TO = "meetchunk@chunkapp.com"
SEGMENT_NAME = "Marketing"
SEGMENT_ENV = "RESEND_MARKETING_SEGMENT_ID"
LEGACY_GENERAL_SEGMENT_ID = "bd174a71-cae1-4af4-8795-a3115d832819"


class BroadcastConfigError(RuntimeError):
    pass


def marketing_segment_id() -> str:
    """The Marketing segment's id, from the environment or cerebral-analytics' config."""
    value = os.environ.get(SEGMENT_ENV, "").strip()
    if not value:
        try:
            result = subprocess.run(
                ["heroku", "config:get", SEGMENT_ENV, "--app", "cerebral-analytics"],
                capture_output=True, text=True, timeout=45,
            )
            value = result.stdout.strip() if result.returncode == 0 else ""
        except (OSError, subprocess.TimeoutExpired):
            value = ""
    if not value:
        raise BroadcastConfigError(
            f"{SEGMENT_ENV} is not set. Create the segment with cerebral's "
            "`scripts/marketing_segment.py --create-segment` and set the id on "
            "cerebral and cerebral-analytics."
        )
    if value == LEGACY_GENERAL_SEGMENT_ID:
        raise BroadcastConfigError(f"{SEGMENT_ENV} points at the legacy General segment.")
    return value
