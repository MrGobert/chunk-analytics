"""
When an account last used Chunk.

``users/{uid}.lastActiveAt`` looks like the answer and isn't. cerebral wrote it
for one day (b7c6bca, 2026-03-03) until dfe43f0 removed every caller, and no
prod user doc carries it (read 2026-10-03). Two signals are live:

- Firebase Auth. Every app refreshes its ID token while it runs (native, web,
  in-process App Intents), so the latest of the account's creation, last
  sign-in and last token refresh moves with each use. The sign-in time alone
  doesn't: an app session stays signed in for months.
- Firestore writes that never refresh a token: inbox captures (the web
  clipper, the share sheet, email-in), chats and captures counted in
  usage_monthly, and App Intents jobs.

cerebral's document retention sweep reads the same two signals
(services/documents/retention.py there); keep them in step. So do the
14-day re-engagement email and the subscriber funnel's "Active (30d)" stage.
"""

from datetime import datetime, timezone
from typing import Dict, Iterable, Optional, Set

import firebase_setup  # noqa: F401  (initializes the default Firebase app)


def last_seen(user) -> Optional[datetime]:
    """The latest of a Firebase Auth record's creation, last sign-in and last
    token refresh, or None when it carries none."""
    meta = user.user_metadata
    stamps = [
        t
        for t in (meta.creation_timestamp, meta.last_sign_in_timestamp, meta.last_refresh_timestamp)
        if t
    ]
    if not stamps:
        return None
    return datetime.fromtimestamp(max(stamps) / 1000, timezone.utc)


def accounts_last_seen_between(start: datetime, end: datetime) -> Dict[str, Optional[str]]:
    """{uid: Firebase Auth email or None} for each enabled account last seen
    from ``start`` through ``end``.

    Lists every Auth account: one Admin API call per 1,000. Raises when a call
    fails.
    """
    from firebase_admin import auth

    found: Dict[str, Optional[str]] = {}
    for user in auth.list_users().iterate_all():
        if user.disabled:
            continue
        seen = last_seen(user)
        if seen is not None and start <= seen <= end:
            found[user.uid] = user.email or None
    return found


def active_since(db, uids: Iterable[str], since: datetime) -> Set[str]:
    """The accounts among ``uids`` that used Chunk at or after ``since``.

    Firebase Auth first, 100 accounts per Admin API call. Only the accounts
    Auth doesn't show get ``used_since``'s Firestore queries (up to five
    one-doc reads each), so the cost follows the accounts that went quiet. A
    disabled or deleted account is never active. Raises when a call fails.
    """
    from firebase_admin import auth

    uids = list(dict.fromkeys(uids))
    active: Set[str] = set()
    ruled_out: Set[str] = set()
    for start in range(0, len(uids), 100):
        result = auth.get_users([auth.UidIdentifier(uid) for uid in uids[start:start + 100]])
        for user in result.users:
            seen = last_seen(user)
            if user.disabled:
                ruled_out.add(user.uid)
            elif seen is not None and seen >= since:
                active.add(user.uid)
        ruled_out.update(identifier.uid for identifier in result.not_found)
    for uid in uids:
        if uid not in active and uid not in ruled_out and used_since(db, uid, since):
            active.add(uid)
    return active


def used_since(db, uid: str, since: datetime) -> bool:
    """Whether anything that never refreshes an Auth token happened at or
    after ``since``: an inbox capture, a chat or capture counted in
    usage_monthly, or an App Intents job. Raises when a read fails."""
    user = db.collection("users").document(uid)
    inbox = user.collection("inbox")
    iso = since.astimezone(timezone.utc).isoformat()
    queries = [
        # Inbox createdAt is a timestamp from the server, epoch seconds from
        # the Apple share sheet. A range filter only matches values of its own
        # type, so each spelling gets its own query.
        inbox.where("createdAt", ">=", since),
        inbox.where("createdAt", ">=", since.timestamp()),
        inbox.where("createdAt", ">=", iso),
        # cerebral writes these as ISO strings: "+00:00" and "Z" respectively.
        user.collection("usage_monthly").where("updated_at", ">=", iso),
        user.collection("intent_jobs").where("updated_at", ">=", iso.replace("+00:00", "Z")),
    ]
    return any(list(query.limit(1).stream()) for query in queries)
