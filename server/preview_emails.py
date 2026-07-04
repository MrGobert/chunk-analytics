#!/usr/bin/env python3
"""
Email Template Preview Server (chunk-analytics)

Run:  python3 preview_emails.py
Open:  http://localhost:8898

Lists all email templates with live preview. Modeled on cerebral/preview_emails.py.
"""

import http.server
import os
import sys
import urllib.parse

# Add server dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import email_service

PORT = 8898

# All available email templates with sample data
TEMPLATES = {
    "welcome": {
        "name": "Welcome (Instant)",
        "category": "Welcome Sequence",
        "fn": lambda: email_service.get_welcome_email("James"),
    },
    "day1_help_center": {
        "name": "Day 1 — Help Center",
        "category": "Welcome Sequence",
        "fn": lambda: email_service.get_day1_help_center_email("James"),
    },
    "day3_artifacts": {
        "name": "Day 3 — Artifacts",
        "category": "Welcome Sequence",
        "fn": lambda: email_service.get_day3_artifacts_email("James"),
    },
    "day7_researcher_stories": {
        "name": "Day 7 — Researcher Stories",
        "category": "Welcome Sequence",
        "fn": lambda: email_service.get_day7_researcher_stories_email("James"),
    },
    "trial_started": {
        "name": "Trial Started",
        "category": "Trial & Subscription",
        "fn": lambda: email_service.get_trial_started_email("James"),
    },
    "trial_ending_24h": {
        "name": "Trial Ending (24h)",
        "category": "Trial & Subscription",
        "fn": lambda: email_service.get_trial_ending_email("James", hours_remaining=24),
    },
    "trial_ending_48h": {
        "name": "Trial Ending (2 days)",
        "category": "Trial & Subscription",
        "fn": lambda: email_service.get_trial_ending_email("James", hours_remaining=48),
    },
    "subscription_expired": {
        "name": "Subscription Expired",
        "category": "Trial & Subscription",
        "fn": lambda: email_service.get_subscription_expired_email("James"),
    },
    "billing_issue": {
        "name": "Billing Issue",
        "category": "Trial & Subscription",
        "fn": lambda: email_service.get_billing_issue_email("James"),
    },
    "renewal_reminder": {
        "name": "Renewal Reminder (7 days)",
        "category": "Trial & Subscription",
        "fn": lambda: email_service.get_renewal_reminder_email("James", days_until_renewal=7, amount="$9.99"),
    },
    "monthly_recap": {
        "name": "Monthly Recap",
        "category": "Engagement",
        "fn": lambda: email_service.get_monthly_recap_email("James", searches=127, documents=23, images=8, notes=34, collections=6),
    },
    "monthly_recap_light": {
        "name": "Monthly Recap (Light User)",
        "category": "Engagement",
        "fn": lambda: email_service.get_monthly_recap_email("James", searches=12, documents=2, images=0, notes=0, collections=0),
    },
    "reengagement_14day": {
        "name": "14-Day Re-engagement",
        "category": "Engagement",
        "fn": lambda: email_service.get_reengagement_14day_email("James"),
    },
    "signup_no_trial_nudge": {
        "name": "Signup — No Trial Nudge",
        "category": "Engagement",
        "fn": lambda: email_service.get_signup_no_trial_nudge_email("James"),
    },
    "winback_7day": {
        "name": "7-Day Winback",
        "category": "Winback",
        "fn": lambda: email_service.get_winback_7day_email("James"),
    },
    "winback_30day": {
        "name": "30-Day Winback",
        "category": "Winback",
        "fn": lambda: email_service.get_winback_30day_email("James"),
    },
    "memory_2_announcement": {
        "name": "Memory 2.0 Announcement",
        "category": "Announcements",
        "fn": lambda: email_service.get_memory_2_announcement_email("James"),
    },
    "feature_announcement": {
        "name": "Feature Announcement",
        "category": "Announcements",
        "fn": lambda: email_service.get_feature_announcement_email(
            "James",
            feature_name="Smart Search",
            feature_description="Find anything across all your notes, documents, and conversations with AI-powered semantic search.",
            feature_emoji="🔍",
        ),
    },
}


def build_index_html():
    """Build the template gallery page — Paper & Ember chrome."""
    categories = {}
    for key, tpl in TEMPLATES.items():
        cat = tpl["category"]
        if cat not in categories:
            categories[cat] = []
        subject, _, _ = tpl["fn"]()
        categories[cat].append((key, tpl["name"], subject))

    cards = ""
    for cat, items in categories.items():
        cards += f'<h2 style="margin:32px 0 16px;color:#BD3717;font-size:13px;letter-spacing:0.12em;text-transform:uppercase">{cat}</h2>\n'
        cards += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">\n'
        for key, name, subject in items:
            cards += f'''<a href="/preview/{key}" style="text-decoration:none;color:inherit;display:block;padding:16px 20px;background:#FFFDF8;border-radius:16px;border:1px solid rgba(45,36,24,0.10);transition:box-shadow 0.15s">
  <div style="font-weight:700;font-size:15px;color:#2D2418;margin-bottom:4px">{name}</div>
  <div style="font-size:13px;color:#6B5D4F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{subject}</div>
</a>\n'''
        cards += '</div>\n'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chunk Email Previews — Paper &amp; Ember</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
body {{ font-family:'DM Sans',sans-serif; background:#FAF5EE; margin:0; padding:40px 20px; }}
.container {{ max-width:960px; margin:0 auto; }}
h1 {{ color:#2D2418; font-family:'Fraunces',Georgia,serif; font-weight:600; font-size:30px; margin:0 0 8px; }}
.subtitle {{ color:#6B5D4F; font-size:14px; margin-bottom:32px; }}
a:hover {{ box-shadow:0 2px 4px rgba(45,36,24,0.08),0 16px 40px rgba(93,64,28,0.14) !important; border-color:rgba(45,36,24,0.30) !important; }}
</style>
</head>
<body>
<div class="container">
<h1>📧 Chunk Email Templates</h1>
<p class="subtitle">{len(TEMPLATES)} templates · Paper &amp; Ember · Click to preview</p>
{cards}
</div>
</body>
</html>"""


class EmailPreviewHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "" or path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(build_index_html().encode())
            return

        if path.startswith("/preview/"):
            key = path[len("/preview/"):]
            if key in TEMPLATES:
                subject, html, text = TEMPLATES[key]["fn"]()
                # Replace the unsubscribe placeholder for preview (cream-soft on night footer)
                html = html.replace(
                    "{UNSUBSCRIBE_LINK_PLACEHOLDER}",
                    '<a href="#" style="color:#C9B89F;text-decoration:none">Unsubscribe</a><span style="color:rgba(246,239,228,0.45)"> · </span>',
                )
                preview = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{subject}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
body {{ margin:0; background:#FAF5EE; font-family:'DM Sans',sans-serif; }}
.toolbar {{ position:sticky; top:0; z-index:100; background:#241B12; padding:12px 24px; display:flex; align-items:center; gap:16px; box-shadow:0 2px 8px rgba(45,36,24,0.3); }}
.toolbar a {{ color:#FF6A42; text-decoration:none; font-size:14px; font-weight:700; }}
.toolbar .subject {{ color:#F6EFE4; font-size:14px; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
.toolbar .template-name {{ color:#C9B89F; font-size:11px; letter-spacing:0.05em; }}
</style>
</head>
<body>
<div class="toolbar">
  <a href="/">← All Templates</a>
  <span class="subject">{subject}</span>
  <span class="template-name">{key}</span>
</div>
{html}
</body>
</html>"""
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(preview.encode())
                return

        self.send_response(404)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Not found")

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", PORT), EmailPreviewHandler)
    print(f"\n  📧 Email Preview Server (chunk-analytics)")
    print(f"  {'─' * 40}")
    print(f"  Open:  http://localhost:{PORT}")
    print(f"  Templates: {len(TEMPLATES)}")
    print(f"  {'─' * 40}")
    print(f"  Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()
