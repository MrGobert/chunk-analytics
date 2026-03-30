import os
import sys
import json
import urllib.request
import urllib.parse
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

# Add server to path so we can import email_service
sys.path.append(os.path.join(os.path.dirname(__file__), 'server'))
try:
    from server.email_service import (
        _base_email_template,
        _feature_card,
        _serif_statement,
        _protocol_step,
        BRAND, FONT_SANS, FONT_MONO
    )
except ImportError:
    print("Could not import email_service")
    sys.exit(1)

RESEND_API_KEY = os.getenv("RESEND_API_KEY")

if not RESEND_API_KEY:
    print("Missing RESEND_API_KEY")
    sys.exit(1)


def generate_email_html():
    """Generate the Help Center announcement email HTML."""

    body = f"""
    <p style="margin:0 0 16px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Chunk is a powerful workspace — AI chat, research reports, connected notes, collections, artifacts, and more. That's a lot to explore.
    </p>
    <p style="margin:0 0 24px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        We built the <strong style="color:{BRAND['primary']}">Help Center</strong> so you always know exactly where to go next. Step-by-step guides, feature deep-dives, real workflows, and quick answers — all in one place.
    </p>

    {_serif_statement("Learn faster. Get unstuck.")}

    {_feature_card("🚀", "Getting Started", "New to Chunk? A 10-minute walkthrough covering your first question, first research report, first note, and first collection.", BRAND['color_notes'], "ONBOARDING")}

    {_feature_card("🔍", "Feature Guides", "Deep dives into AI Chat, Research Reports, Notes & Wiki-Links, Artifacts, Documents, and Collections — with tips you won't find anywhere else.", BRAND['color_documents'], "FEATURES")}

    {_feature_card("🗺️", "Workflows", "Step-by-step guides for real tasks: researching a topic end-to-end, organizing your notes, and building a knowledge base from scratch.", BRAND['color_urls'], "GUIDES")}

    {_feature_card("💡", "FAQ", "Quick answers on billing, platforms, AI models, privacy, exporting data, and more — so you can spend less time searching and more time learning.", BRAND['gold'], "ANSWERS")}

    <p style="margin:20px 0 4px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6;text-align:center" class="text-dark">
        Whether you're just getting started or want to go deeper — the Help Center has you covered.
    </p>
    """

    html = _base_email_template(
        preheader="New: Help Center with step-by-step guides, feature tutorials, and answers to common questions.",
        hero_title="Your guide to getting the most out of Chunk.",
        hero_subtitle="Everything you need — from first steps to advanced workflows.",
        body_content=body,
        cta_text="Explore the Help Center",
        cta_url="https://www.chunkapp.com/help",
        hero_dark=True,
        hero_label="RESOURCE",
        hero_serif_word="guide"
    )
    return html


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


def update_broadcast(broadcast_id, html):
    payload = json.dumps({"html": html}).encode('utf-8')
    req = urllib.request.Request(
        f"https://api.resend.com/broadcasts/{broadcast_id}",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "ChunkMailer/1.0"
        },
        method='PATCH'
    )
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
            print(f"Success! Updated Broadcast ID: {broadcast_id}")
            return result
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"Error updating broadcast: {e.code} - {error_body}")
        return None


def create_broadcast(segment_id, html):
    payload = {
        "segment_id": segment_id,
        "name": "Help Center Announcement",
        "subject": "New: Your complete guide to Chunk \u2014 Help Center is live",
        "from": "Chunk AI <info@chunkapp.com>",
        "html": html,
        "reply_to": "info@chunkapp.com"
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        "https://api.resend.com/broadcasts",
        data=data,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "ChunkMailer/1.0"
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
            print(f"Success! Created Broadcast ID: {result.get('id')}")
            return result
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"Error creating broadcast: {e.code} - {error_body}")
        return None


if __name__ == "__main__":
    segment_id = "bd174a71-cae1-4af4-8795-a3115d832819"
    print(f"Using segment: General ({segment_id})")

    print("Generating HTML template...")
    html = generate_email_html()

    # Replace the placeholder with a white Resend Broadcast Unsubscribe link
    unsubscribe_html = '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#FFFFFF;text-decoration:none">Unsubscribe</a><span style="color:#FFFFFF;opacity:0.3"> \u00b7 </span>'
    html = html.replace("{UNSUBSCRIBE_LINK_PLACEHOLDER}", unsubscribe_html)

    # Save HTML for local preview
    preview_path = os.path.join(os.path.dirname(__file__), 'help-center-broadcast-email.html')
    with open(preview_path, 'w') as f:
        f.write(html)
    print(f"HTML saved to: {preview_path}")

    # Check for existing draft to update
    print("Checking for existing broadcast draft...")
    broadcasts = list_broadcasts()
    existing = next((b for b in broadcasts if "Help Center" in b.get('name', '')), None)

    if existing:
        print(f"Found existing draft: {existing['name']} (ID: {existing['id']})")
        print("Updating broadcast with new HTML...")
        update_broadcast(existing['id'], html)
    else:
        print("No existing draft found. Creating new broadcast...")
        create_broadcast(segment_id, html)
