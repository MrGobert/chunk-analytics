"""Create (or update) the "What's New — Summer 2026" Resend broadcast DRAFT.

Draft only — this script never sends. Review, test-send, and broadcast from the
Resend dashboard. Safe to re-run: an existing draft with the same name is
PATCHed instead of duplicated.

The email HTML lives in server/email_service.py (get_whats_new_summer_2026_email),
which uses the Paper & Ember design system (Chunk Design System v2).
"""
import os
import sys
import json
import urllib.request
import urllib.error

# Parse .env.vercel directly to avoid dependency
env_path = os.path.join(os.path.dirname(__file__), '.env.vercel')
if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                os.environ[key.strip()] = val.strip(' "\'').replace('\\n', '\n')

# Add server to path so we can import email_service (reads env at import time)
sys.path.append(os.path.join(os.path.dirname(__file__), 'server'))
try:
    from server.email_service import get_whats_new_summer_2026_email
except ImportError:
    print("Could not import email_service")
    sys.exit(1)

RESEND_API_KEY = os.getenv("RESEND_API_KEY")

BROADCAST_NAME = "What's New — Summer 2026"
SEGMENT_ID = "bd174a71-cae1-4af4-8795-a3115d832819"  # General


def list_broadcasts():
    req = urllib.request.Request(
        "https://api.resend.com/broadcasts",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "User-Agent": "ChunkMailer/1.0"
        }
    )
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return data.get('data', [])
    except Exception as e:
        print(f"Error fetching broadcasts: {e}")
        return []


def _resend_request(url, payload, method):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "ChunkMailer/1.0"
        },
        method=method
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())


def update_broadcast(broadcast_id, subject, html, text):
    # `subject`/`text` are documented update fields; fall back to html-only if rejected.
    for payload in ({"html": html, "subject": subject, "text": text}, {"html": html}):
        try:
            _resend_request(f"https://api.resend.com/broadcasts/{broadcast_id}", payload, 'PATCH')
            print(f"Success! Updated Broadcast ID: {broadcast_id}")
            if "subject" not in payload:
                print("Note: API rejected subject/text on PATCH — update the subject in the Resend dashboard if it changed.")
            return True
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            print(f"Error updating broadcast ({list(payload.keys())}): {e.code} - {error_body}")
    return False


def create_broadcast(subject, html, text):
    base_payload = {
        "segment_id": SEGMENT_ID,
        "name": BROADCAST_NAME,
        "subject": subject,
        "from": "Chunk AI <info@chunkapp.com>",
        "html": html,
        "reply_to": "info@chunkapp.com"
    }
    # `text` is a documented broadcast field; fall back without it if the API rejects it.
    for payload in ({**base_payload, "text": text}, base_payload):
        try:
            result = _resend_request("https://api.resend.com/broadcasts", payload, 'POST')
            print(f"Success! Created Broadcast ID: {result.get('id')}")
            return result
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            print(f"Error creating broadcast ({list(payload.keys())}): {e.code} - {error_body}")
    return None


if __name__ == "__main__":
    print("Generating email from server/email_service.py (Paper & Ember)...")
    subject, html, text = get_whats_new_summer_2026_email()

    # The generator owns the unsubscribe replacement — verify, never re-replace.
    assert "{UNSUBSCRIBE_LINK_PLACEHOLDER}" not in html, "unsubscribe placeholder was not replaced"
    assert "RESEND_UNSUBSCRIBE_URL" in html, "Resend broadcast unsubscribe merge tag missing"

    # Save HTML for local preview
    preview_path = os.path.join(os.path.dirname(__file__), 'whats-new-broadcast-email.html')
    with open(preview_path, 'w') as f:
        f.write(html)
    print(f"Subject: {subject}")
    print(f"HTML saved to: {preview_path}")

    if not RESEND_API_KEY:
        print("\nMissing RESEND_API_KEY — preview written, but no draft was created.")
        print("The key lives on Heroku (cerebral-analytics), not in this repo. Either:")
        print("  heroku config:get RESEND_API_KEY --app cerebral-analytics")
        print("  (then: RESEND_API_KEY=... python3 create_whats_new_broadcast.py)")
        print("or add RESEND_API_KEY=... to .env.vercel and re-run.")
        sys.exit(1)

    print(f"\nUsing segment: General ({SEGMENT_ID})")
    print("Checking for existing broadcast draft...")
    broadcasts = list_broadcasts()
    existing = next((b for b in broadcasts if BROADCAST_NAME in b.get('name', '')), None)

    if existing:
        print(f"Found existing draft: {existing['name']} (ID: {existing['id']})")
        print("Updating broadcast with new content...")
        update_broadcast(existing['id'], subject, html, text)
    else:
        print("No existing draft found. Creating new broadcast draft...")
        create_broadcast(subject, html, text)

    print("\nDraft only — nothing was sent. Review and send from the Resend dashboard.")
