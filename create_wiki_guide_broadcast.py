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
        _dark_card,
        BRAND
    )
except ImportError:
    print("Could not import email_service")
    sys.exit(1)

RESEND_API_KEY = os.getenv("RESEND_API_KEY")

if not RESEND_API_KEY:
    print("Missing RESEND_API_KEY")
    sys.exit(1)

def get_segments():
    req = urllib.request.Request(
        "https://api.resend.com/segments",
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
        print(f"Error fetching segments: {e}")
        return []

def generate_email_html():
    border_color = BRAND.get('border', '#E5E7EB')

    body = f"""
    <div style="text-align: center; margin-bottom: 24px;">
        <img src="https://chunk-analytics.vercel.app/notes_feature_lightmode.jpg" alt="Chunk App Interface" style="max-width: 500px; width: 100%; height: auto; border-radius: 8px; border: 1px solid {border_color}; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
    </div>
    <p style="margin:0 0 16px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        A personal wiki isn't just a place to store information—it's a living system that grows with your ideas. 
    </p>
    <p style="margin:0 0 20px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        By connecting notes with [[brackets]], you create an interconnected web of knowledge. Here's a quick guide on how to build yours:
    </p>

    {_serif_statement("Building your wiki.")}

    {_feature_card("🧠", "Connecting Ideas", "Link directly related concepts or piece together partially related information. Watch as emergent insights naturally surface without extra organization.", BRAND['color_notes'], "LEARNING")}
    
    {_feature_card("📚", "Study & Teaching Tool", "Perfect for progressive learning. Contextual connections ensure you're not just memorizing isolated facts, but understanding an entire topic's ecosystem.", BRAND['color_documents'], "EDUCATION")}
    
    {_feature_card("🗺️", "Maps of Content (MoC)", "Create a central glossary of note links to serve as a hub. Navigate into any subtopic effortlessly from your MoC.", BRAND['color_urls'], "ORGANIZATION")}
    
    {_feature_card("🌐", "Share with Others", "Publish your personal wiki with live, SEO-friendly web links. Use cascading permissions to share an entire Map of Content and set granular privacy instantly.", BRAND['accent_blue'], "SHARING")}

    <p style="margin:20px 0 0 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Ready to turn your notes into a powerful knowledge graph? Try Chunk on the new web app and discover our new Notes features today.
    </p>
    """

    html = _base_email_template(
        preheader="Learn how to turn your notes into a personal wiki using Maps of Content, interconnected ideas, and live web sharing.",
        hero_title="How To Turn your notes into a Wiki",
        hero_subtitle="A guide to building interconnected notes.",
        body_content=body,
        cta_text="Try Chunk on www.ChunkApp.com",
        cta_url="https://www.chunkapp.com",
        hero_dark=True,
        hero_label="GUIDE",
        hero_serif_word="Wiki"
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
        "name": "How To Turn your notes into a Wiki Guide",
        "subject": "How To Turn your notes into a Wiki 🧠",
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
    unsubscribe_html = '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#FFFFFF;text-decoration:none">Unsubscribe</a><span style="color:#FFFFFF;opacity:0.3"> · </span>'
    html = html.replace("{UNSUBSCRIBE_LINK_PLACEHOLDER}", unsubscribe_html)

    # Check for existing draft to update
    print("Checking for existing broadcast draft...")
    broadcasts = list_broadcasts()
    existing = next((b for b in broadcasts if "Wiki Guide" in b.get('name', '')), None)

    if existing:
        print(f"Found existing draft: {existing['name']} (ID: {existing['id']})")
        print("Updating broadcast with fixed HTML...")
        update_broadcast(existing['id'], html)
    else:
        print("No existing draft found. Creating new broadcast...")
        create_broadcast(segment_id, html)
