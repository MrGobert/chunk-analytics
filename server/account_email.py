"""
The address a user's email goes to: their Firebase Auth email.

Auth holds either the sign-in identity or an address the user proved they own
through cerebral's /api/user/email. ``users/{uid}.email`` in Firestore looks
just as authoritative and is not: firestore.rules lets the signed-in owner
write that doc, and docs written before cerebral#56 added a rules guard
(2026-09-30) keep whatever a client put there. Sending to it would let anyone
point Chunk's mail at an inbox they don't own. cerebral resolves its own
senders the same way (utils/account_email.py there).
"""

from typing import Dict, Iterable, Optional

import firebase_setup  # noqa: F401  (initializes the default Firebase app)

# get_users accepts at most 100 identifiers per call.
AUTH_BATCH_SIZE = 100


def _is_uid(uid) -> bool:
    # Auth uids are 1-128 characters. firebase_admin raises ValueError for
    # anything else instead of reporting "not found".
    return isinstance(uid, str) and 0 < len(uid) <= 128


def account_email(uid) -> Optional[str]:
    """Firebase Auth's email for ``uid``, or None when there is no such account
    or it has no email.

    Raises when the lookup itself fails, so a caller can tell "no address"
    from "couldn't check".
    """
    from firebase_admin import auth

    if not _is_uid(uid):
        return None
    try:
        user = auth.get_user(uid)
    except auth.UserNotFoundError:
        return None
    return user.email or None


def account_emails(uids: Iterable[str]) -> Dict[str, str]:
    """{uid: Firebase Auth email} for each uid with an account that has an email.

    One Admin API call per AUTH_BATCH_SIZE uids, for the beat tasks' fan-outs.
    Raises when a lookup fails.
    """
    from firebase_admin import auth

    wanted = list(dict.fromkeys(uid for uid in uids if _is_uid(uid)))
    found: Dict[str, str] = {}
    for start in range(0, len(wanted), AUTH_BATCH_SIZE):
        batch = wanted[start:start + AUTH_BATCH_SIZE]
        result = auth.get_users([auth.UidIdentifier(uid) for uid in batch])
        for user in result.users:
            if user.email:
                found[user.uid] = user.email
    return found
