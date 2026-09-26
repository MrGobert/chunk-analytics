"""Preview or save the Chunk 2.6.0 Resend broadcast. Never sends or schedules.

    python3 create_chunk_260_broadcast.py
    python3 create_chunk_260_broadcast.py --save-draft

Uses RESEND_API_KEY from the environment, or reads the existing key from the
cerebral-analytics Heroku app into memory. Credentials are never persisted.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from server.chunk_260_email import get_chunk_260_email, UNSUBSCRIBE


BROADCAST_NAME = "Chunk 2.6.0 — Siri, Spotlight & Shortcuts"
SEGMENT_ID = "bd174a71-cae1-4af4-8795-a3115d832819"
FROM_EMAIL = "Chunk AI <info@chunkapp.com>"
REPLY_TO = "info@chunkapp.com"
OUTPUT_DIR = Path(__file__).resolve().parent


class DraftError(RuntimeError):
    pass


def get_api_key():
    key = os.environ.get("RESEND_API_KEY", "").strip()
    if not key:
        result = subprocess.run(
            ["heroku", "config:get", "RESEND_API_KEY", "--app", "cerebral-analytics"],
            capture_output=True, text=True, timeout=45,
        )
        if result.returncode:
            raise DraftError("Could not read the existing Resend credential from Heroku.")
        key = result.stdout.strip()
    if not key.startswith("re_"):
        raise DraftError("No valid Resend API credential is available.")
    return key


class Resend:
    def __init__(self, api_key):
        self._api_key = api_key
        self._last_request = 0.0

    def request(self, path, method="GET", payload=None):
        # This client intentionally cannot reach any email or broadcast send route.
        route = path.split("?", 1)[0].split("/")
        if not (route[0] in ("broadcasts", "segments") and len(route) <= 2):
            raise DraftError("Unsupported API route for a draft-only campaign.")
        if method == "POST":
            if path != "broadcasts" or not payload or payload.get("send") is not False:
                raise DraftError("Creating a broadcast requires send=false.")
        elif method == "PATCH":
            if len(route) != 2 or route[0] != "broadcasts" or not route[1]:
                raise DraftError("Only broadcast draft updates are supported.")
        elif method != "GET":
            raise DraftError("Unsupported API method.")
        if payload and ("scheduled_at" in payload or payload.get("send") is True):
            raise DraftError("Sending and scheduling are disabled.")

        time.sleep(max(0, 0.6 - (time.monotonic() - self._last_request)))
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            "https://api.resend.com/" + path, data=body, method=method,
            headers={
                "Authorization": "Bearer " + self._api_key,
                "Content-Type": "application/json",
                "User-Agent": "ChunkDraftMailer/2.6.0",
            },
        )
        self._last_request = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Do not expose request headers or echo an arbitrary API response.
            raise DraftError(f"Resend {method} failed with HTTP {error.code}; no automatic retry.") from None
        except (urllib.error.URLError, TimeoutError):
            raise DraftError(
                "Resend request did not complete. Re-run to discover any saved draft before retrying; "
                "no automatic retry was attempted."
            ) from None


def list_broadcasts(client):
    broadcasts = []
    cursor = None
    seen = set()
    while True:
        query = {"limit": 100}
        if cursor:
            query["after"] = cursor
        page = client.request("broadcasts?" + urllib.parse.urlencode(query))
        rows = page.get("data")
        if not isinstance(rows, list):
            raise DraftError("Resend returned an invalid broadcast list; refusing to create a duplicate.")
        broadcasts.extend(rows)
        if not page.get("has_more"):
            return broadcasts
        cursor = rows[-1].get("id") if rows else None
        if not cursor or cursor in seen:
            raise DraftError("Resend pagination did not advance; refusing to create a duplicate.")
        seen.add(cursor)


def ensure_draft(broadcast):
    if broadcast.get("status") != "draft" or broadcast.get("scheduled_at") or broadcast.get("sent_at"):
        raise DraftError("The matching broadcast is not an unscheduled draft; it was not changed.")


def check_routing(broadcast):
    segment = broadcast.get("segment_id") or broadcast.get("audience_id")
    if segment != SEGMENT_ID:
        raise DraftError("The broadcast does not target the expected General segment.")
    reply = broadcast.get("reply_to")
    if reply not in (REPLY_TO, [REPLY_TO]):
        raise DraftError("The broadcast reply-to differs from info@chunkapp.com.")


def save_draft(client, subject, html, text):
    segment = client.request("segments/" + SEGMENT_ID)
    if segment.get("id") != SEGMENT_ID or segment.get("name") != "General":
        raise DraftError("The configured General segment could not be verified.")
    matches = [b for b in list_broadcasts(client) if b.get("name") == BROADCAST_NAME]
    if len(matches) > 1:
        raise DraftError("Multiple broadcasts have this exact name; none was changed.")
    content = {"name": BROADCAST_NAME, "from": FROM_EMAIL, "subject": subject, "html": html, "text": text}
    if matches:
        ensure_draft(matches[0])
        broadcast_id = matches[0]["id"]
        current = client.request("broadcasts/" + broadcast_id)
        ensure_draft(current)
        check_routing(current)
        client.request("broadcasts/" + broadcast_id, "PATCH", content)
        action = "updated"
    else:
        created = client.request("broadcasts", "POST", {
            **content, "segment_id": SEGMENT_ID, "reply_to": REPLY_TO, "send": False,
        })
        broadcast_id = created.get("id")
        if not broadcast_id:
            raise DraftError("Resend did not return a draft ID; inspect the dashboard before retrying.")
        action = "created"

    saved = client.request("broadcasts/" + broadcast_id)
    ensure_draft(saved)
    check_routing(saved)
    for field, expected in content.items():
        if saved.get(field) != expected:
            raise DraftError(f"Saved draft {broadcast_id}: {field} did not match the approved content.")
    return {
        "id": broadcast_id, "name": BROADCAST_NAME, "action": action,
        "status": saved["status"], "segment_id": SEGMENT_ID, "segment_name": "General",
        "from": FROM_EMAIL, "reply_to": REPLY_TO, "subject": subject,
        "scheduled_at": saved.get("scheduled_at"), "sent_at": saved.get("sent_at"),
        "html_sha256": hashlib.sha256(html.encode()).hexdigest(),
        "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "dashboard_url": "https://resend.com/broadcasts/" + broadcast_id,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save-draft", action="store_true", help="Create or update the draft in Resend; never send.")
    args = parser.parse_args()
    subject, html, text = get_chunk_260_email()
    if UNSUBSCRIBE not in html or UNSUBSCRIBE not in text or "{UNSUBSCRIBE_LINK_PLACEHOLDER}" in html:
        raise DraftError("The broadcast unsubscribe markup is missing or invalid.")
    if len(html.encode()) >= 95_000:
        raise DraftError("HTML is too large for the campaign's clipping budget.")
    for extension, content in (("html", html), ("txt", text)):
        path = OUTPUT_DIR / ("chunk-260-broadcast-email." + extension)
        path.write_text(content, encoding="utf-8")
        print(f"Preview: {path}")
    print(f"Subject: {subject}\nHTML size: {len(html.encode()):,} bytes")
    if not args.save_draft:
        print("Preview only. No Resend changes made.")
        return
    receipt = save_draft(Resend(get_api_key()), subject, html, text)
    (OUTPUT_DIR / "chunk-260-broadcast-receipt.json").write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
    )
    print(json.dumps(receipt, indent=2, ensure_ascii=False))
    print("Verified draft only. Nothing sent or scheduled.")


if __name__ == "__main__":
    try:
        main()
    except (DraftError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error)) from None
