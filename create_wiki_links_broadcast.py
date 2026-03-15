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
    body = f"""
    <p style="margin:0 0 20px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Knowledge is interconnected. But until now, your notes have lived in isolation.
    </p>
    <p style="margin:0 0 24px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        We're introducing <strong>Wiki Links</strong> in Chunk. By linking your notes together with [[brackets]], a living, visual knowledge graph emerges naturally. No extra organization required.
    </p>

    {_serif_statement("Why backlinks supercharge retention.")}

    {_feature_card("🧠", "Emergent Insights", "You didn't set out to connect your ideas, but the graph reveals them. Discover connections you didn't plan as your knowledge map grows organically.", BRAND['color_notes'], "LEARNING")}
    
    {_feature_card("🔗", "Contextual Connections", "Every note carries the weight of its connections. A single concept links back to everything you've researched, creating multiple entry points for recall.", BRAND['color_documents'], "CONTEXT")}
    
    {_feature_card("🌐", "Publish your Personal Wiki", "Every shared note gets a beautiful, SEO-friendly URL. Build an entire Map of Content with live web links and granular privacy.", BRAND['color_urls'], "SHARING")}

    <p style="margin:20px 0 0 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Start building your knowledge network today. Just type <code>[[</code> in any note to try it.
    </p>
    """

    html = _base_email_template(
        preheader="Knowledge is interconnected. Introducing Wiki Links and Knowledge Graphs in Chunk.",
        hero_title="Knowledge is interconnected.",
        hero_subtitle="Introducing Wiki Links and Personal Wikis.",
        body_content=body,
        cta_text="Discover Wiki Links",
        cta_url="https://www.chunkapp.com/wiki-links",
        hero_dark=True,
        hero_label="NEW FEATURE",
        hero_serif_word="interconnected."
    )
    return html

def create_broadcast(segment_id, html):
    payload = {
        "segment_id": segment_id,
        "name": "Wiki Links Announcement",
        "subject": "Knowledge is interconnected: Introducing Wiki Links.",
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
    print("Fetching segments...")
    segments = get_segments()
    if not segments:
        print("No segments found in Resend account. Cannot create broadcast.")
        sys.exit(1)
    
    # Just use the first segment we find
    segment_id = segments[0]['id']
    segment_name = segments[0]['name']
    print(f"Using segment: {segment_name} ({segment_id})")

    print("Generating HTML template...")
    html = generate_email_html()
    
    # Replace the placeholder with a white Resend Broadcast Unsubscribe link
    unsubscribe_html = '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#FFFFFF;text-decoration:none">Unsubscribe</a><span style="color:#FFFFFF;opacity:0.3"> · </span>'
    html = html.replace("{UNSUBSCRIBE_LINK_PLACEHOLDER}", unsubscribe_html)
    
    print("Creating Resend broadcast draft...")
    create_broadcast(segment_id, html)
