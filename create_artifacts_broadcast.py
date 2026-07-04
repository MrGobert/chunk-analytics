# NOTE: Historical one-shot broadcast — its inline HTML predates the Paper & Ember
# design system (July 2026). Restyle before reusing.
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
        _stat_block,
        _protocol_step,
        _gradient_banner,
        BRAND, FONT_SANS, FONT_SERIF, FONT_MONO
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

def _use_case_card(emoji, label, label_color, headline, scenario, input_text, output_text):
    """Custom use case card with accent pill and input/output breakdown."""
    return f'''
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:16px;background-color:{BRAND['bg_dark']};border-radius:16px;border:1px solid {BRAND['surface_dark'] if 'surface_dark' in BRAND else '#2A2A2A'};overflow:hidden" class="dark-card">
        <tr>
            <td style="padding:24px">
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                        <td>
                            <span style="display:inline-block;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#FFFFFF;background-color:{label_color};padding:4px 10px;border-radius:100px;font-weight:700">{emoji} {label}</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding-top:14px">
                            <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-weight:700;color:#FFFFFF;font-size:20px;letter-spacing:-0.02em">{headline}</p>
                            <p style="margin:0 0 16px 0;font-family:{FONT_SANS};color:{BRAND['text_muted']};font-size:14px;line-height:1.5">{scenario}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="border-top:1px solid #2A2A2A;padding-top:14px">
                            <table width="100%" border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="width:50%;vertical-align:top;padding-right:8px">
                                        <p style="margin:0 0 2px 0;font-family:{FONT_MONO};font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:{label_color};font-weight:700">INPUT</p>
                                        <p style="margin:0;font-family:{FONT_SANS};color:rgba(255,255,255,0.7);font-size:13px">{input_text}</p>
                                    </td>
                                    <td style="width:50%;vertical-align:top;padding-left:8px">
                                        <p style="margin:0 0 2px 0;font-family:{FONT_MONO};font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:{label_color};font-weight:700">OUTPUT</p>
                                        <p style="margin:0;font-family:{FONT_SANS};color:rgba(255,255,255,0.7);font-size:13px">{output_text}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    '''

def _source_icons_strip():
    """Horizontal strip showing 5 supported input types with icons."""
    sources = [
        ("🎬", "YouTube Videos"),
        ("📄", "PDFs & Docs"),
        ("🎙️", "Podcasts"),
        ("🎧", "Audio Files"),
        ("🌐", "Web Articles")
    ]
    
    cells = ""
    for emoji, label in sources:
        cells += f'''
        <td style="text-align:center;padding:12px 8px;background-color:{BRAND['surface_elevated']};border-radius:8px" class="surface-card">
            <div style="font-size:18px;margin-bottom:4px">{emoji}</div>
            <p style="margin:0;font-family:{FONT_MONO};font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:{BRAND['text_muted']}" class="text-muted-dm">{label}</p>
        </td>
        '''
    
    return f'''
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0">
        <tr>
            <td style="padding:0 4px">{cells[0]}</td>
            <td style="width:8px"></td>
            <td style="padding:0 4px">{cells[1]}</td>
            <td style="width:8px"></td>
            <td style="padding:0 4px">{cells[2]}</td>
            <td style="width:8px"></td>
            <td style="padding:0 4px">{cells[3]}</td>
            <td style="width:8px"></td>
            <td style="padding:0 4px">{cells[4]}</td>
        </tr>
    </table>
    '''

def _output_types_section():
    """Five output formats in small dark cards."""
    outputs = [
        ("📝", "Transcripts"),
        ("📋", "Summaries"),
        ("🃏", "Flashcards"),
        ("❓", "Quizzes"),
        ("🗺️", "Concept Maps")
    ]
    
    cards_html = ""
    for emoji, label in outputs:
        cards_html += _dark_card(f'''
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                    <td style="text-align:center">
                        <div style="font-size:24px;margin-bottom:8px">{emoji}</div>
                        <p style="margin:0;font-family:{FONT_SANS};font-weight:700;color:#FFFFFF;font-size:14px">{label}</p>
                    </td>
                </tr>
            </table>
        ''')
    
    return f'''
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:32px 0">
        <tr>
            <td align="center" style="padding:0 0 16px 0">
                <p style="margin:0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_primary']};font-size:20px;text-align:center" class="text-dark">One Input, Five Outputs</p>
            </td>
        </tr>
        <tr>
            <td>
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="width:18%;padding:0 1%">{cards_html.split('</table>')[0]}</table></td>
                        <td style="width:18%;padding:0 1%">{cards_html.split('</table>')[1]}</table></td>
                        <td style="width:18%;padding:0 1%">{cards_html.split('</table>')[2]}</table></td>
                        <td style="width:18%;padding:0 1%">{cards_html.split('</table>')[3]}</table></td>
                        <td style="width:18%;padding:0 1%">{cards_html.split('</table>')[4]}</table></td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    '''

def generate_email_html():
    """Generate the Artifacts announcement email HTML."""
    
    # Source icons strip
    source_icons = _source_icons_strip()
    
    # Output types section
    output_section = _output_types_section()
    
    # How it works steps
    how_it_works = f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:32px 0">
        <tr>
            <td>
                <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_primary']};font-size:20px" class="text-dark">How It Works</p>
                {_protocol_step("01", "Drop in your content", "Paste a URL, upload a PDF, or drag in an audio file")}
                {_protocol_step("02", "Choose your outputs", "Select from transcripts, summaries, flashcards, quizzes, or concept maps")}
                {_protocol_step("03", "Learn, don't just read", "Interactive flashcards, quiz yourself, explore concept maps")}
            </td>
        </tr>
    </table>
    """
    
    # Use case cards
    use_cases = f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:32px 0">
        <tr>
            <td>
                <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_primary']};font-size:20px" class="text-dark">Perfect For Every Learning Style</p>
                
                {_use_case_card(
                    "🎓", "STUDENT", BRAND['primary'],
                    "Ace the Exam",
                    "Drop a 90-min recorded lecture → Get flashcards + a quiz in 60 seconds",
                    "YouTube lecture / Audio recording",
                    "Flashcards for spaced repetition + Quiz for self-testing"
                )}
                
                {_use_case_card(
                    "🔬", "RESEARCHER", BRAND['color_documents'],
                    "Map the Literature",
                    "Upload 5 research PDFs → Get concept maps showing how ideas connect",
                    "PDF papers / Web articles",
                    "Concept maps + Structured summaries"
                )}
                
                {_use_case_card(
                    "💼", "PROFESSIONAL", BRAND['color_urls'],
                    "Extract the Signal",
                    "Paste a 45-min industry podcast → Get a 2-min executive summary",
                    "Podcast URL / YouTube tutorial",
                    "Summary + Transcript with key timestamps"
                )}
            </td>
        </tr>
    </table>
    """
    
    body = f"""
    <p style="margin:0 0 20px 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Turn any content into knowledge. Instantly.
    </p>
    
    {source_icons}
    
    {output_section}
    
    {how_it_works}
    
    {use_cases}
    
    {_serif_statement("Don't just consume. Understand.")}
    
    <p style="margin:20px 0 0 0;font-family:sans-serif;font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Artifacts is available now in Chunk Pro. Transform any content into interactive learning materials in seconds.
    </p>
    """

    html = _base_email_template(
        preheader="Turn lectures, YouTube videos, and PDFs into interactive study guides, flashcards, quizzes, and concept maps in seconds.",
        hero_title="Input Content. Extract Knowledge. Instantly.",
        hero_subtitle="Turn any content into flashcards, quizzes, summaries, and concept maps in seconds.",
        body_content=body,
        cta_text="Try Artifacts →",
        cta_url="https://www.chunkapp.com/artifacts-feature",
        footer_tip="Artifacts is a Pro feature. Upgrade to Chunk Pro to unlock unlimited transformations.",
        hero_dark=True,
        hero_label="NEW FEATURE",
        hero_serif_word="Instantly."
    )
    return html

def create_broadcast(segment_id, html):
    payload = {
        "segment_id": segment_id,
        "name": "Artifacts Feature Announcement",
        "subject": "New: Turn any content into flashcards, quizzes, and summaries — instantly.",
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
    
    # Save HTML for local preview
    preview_path = os.path.join(os.path.dirname(__file__), 'artifacts-broadcast-email.html')
    with open(preview_path, 'w') as f:
        f.write(html)
    print(f"HTML saved to: {preview_path}")
    
    print("Creating Resend broadcast draft...")
    create_broadcast(segment_id, html)