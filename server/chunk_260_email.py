"""Chunk 2.6.0 broadcast: Paper & Ember, with shared email brand tokens.

The screenshot is an authentic, unmodified product capture. All announcement
copy remains live text, and the plain-text edition uses the same feature copy.
"""

from html import escape

from .email_service import BRAND, FONT_MONO, FONT_SANS, FONT_SERIF, GOOGLE_FONTS_URL


SUBJECT = "Chunk 2.6.0 is here: Siri, Spotlight & Shortcuts"
PREHEADER = (
    "Talk to your notes, find your saved work, and try free Artifacts—plus PDF export and a new Workstation."
)
SCREENSHOT_URL = (
    "https://www.chunkapp.com/press/screenshots/iphone/"
    "chunk-iphone-settings-siri-spotlight-1206x2622.png"
)
MARK_URL = "https://www.chunkapp.com/press/brand/chunk-mark-transparent-256.png"
DETAILS_URL = "https://www.chunkapp.com/press-kit#siri"
UNSUBSCRIBE = "{{{RESEND_UNSUBSCRIBE_URL}}}"

INTRO = (
    "Chunk 2.6.0 is now available. Find your saved work with Spotlight, "
    "ask Siri to act on it, and make everyday tasks your own with Apple Shortcuts."
)
REQUIREMENTS = (
    "Requires iOS/iPadOS 27 or macOS 27. Siri AI must be available and enabled "
    "on a compatible device. Also supported on visionOS 27; Siri AI availability "
    "varies by device, language, and region."
)
FIND_COPY = (
    "Your notes, documents, research, collections, Artifacts, captures, conversations, "
    "flashcards, and automations are indexed right on your device. "
    "Find, open, and act on them by name."
)
VOICE_COPY = (
    "Dictate a new note, add to an existing one, or rename and move things "
    "into any folder—all hands-free."
)
CONTROL_COPY = (
    "Turn indexing on or off for each device in Settings → Integrations → Siri & Spotlight. "
    "Turning it off removes Chunk content from Siri and Spotlight on that device."
)
SHORTCUTS = (
    ("Save Artifact", "Turn a link, image, or file into notes, summaries, flashcards, and more."),
    ("Research", "Start a cited report that keeps working in the background."),
    ("Add to Collection", "File a note, document, research report, or capture into a collection."),
    ("Review Flashcards", "Open a deck and pick up your next review."),
)
SHORTCUTS_NOTE = (
    "Eleven actions in the Shortcuts app cover creating, appending to, and updating notes; "
    "searching and opening Chunk items; and exporting content and original sources."
)
SAVE_NOTE = (
    'A spoken “save this” creates a Chunk note from what is on screen. '
    "To create an Artifact, use Save Artifact in Shortcuts or the share sheet."
)
FEATURES = (
    (
        "Artifacts are now free.",
        "Turn a video, article, podcast, or PDF into notes, summaries, flashcards, and more. "
        "One a week on Free, unlimited on Pro. Over the limit? Nothing is lost—your work "
        "runs at your next weekly reset.",
        "",
    ),
    (
        "PDFs, ready to share.",
        "Ask for a document in any chat or export any note on iPhone, iPad, and Mac. "
        'Refine it by asking “shorten the intro,” then share it anywhere. '
        "Pro PDFs are yours alone, with no Chunk branding.",
        "",
    ),
    (
        "A Workstation that feels like yours.",
        "Pick up where you left off with recent items, pins, and a tool dock you can "
        "arrange or hide. Your setup follows you across iPhone, iPad, Mac, and web.",
        "",
    ),
    (
        "Automations that lead with answers.",
        "Each automation keeps one living result up to date, with run history, version "
        "comparison, and Run Now. Ask about it in chat or file it into a collection.",
        "",
    ),
    (
        "A starting point, just for you.",
        "Personalized chat starters on your empty chat screen draw on recent conversations "
        "and Memory. These suggestions live inside Chunk, separately from Apple Shortcuts.",
        "Pro · Opt-in",
    ),
)


def _p(copy, *, small=False, margin="0", color=None, css="text-muted-dm"):
    return (
        f'<p class="{css}" style="margin:{margin};font-family:{FONT_SANS};'
        f'font-size:{14 if small else 16}px;line-height:1.65;'
        f'color:{color or BRAND["text_muted"]}">{escape(copy)}</p>'
    )


def _h2(copy, size=28):
    return (
        f'<h2 class="text-dark" style="margin:0 0 14px;font-family:{FONT_SERIF};'
        f'font-size:{size}px;line-height:1.18;font-weight:600;'
        f'letter-spacing:-0.015em;color:{BRAND["text_primary"]}">{escape(copy)}</h2>'
    )


def _button():
    # Table-cell padding keeps the CTA usable in Outlook without external CSS.
    return f'''<table role="presentation" border="0" cellpadding="0" cellspacing="0">
      <tr><td bgcolor="{BRAND['primary_deep']}" style="background-color:{BRAND['primary_deep']};border-radius:16px;mso-padding-alt:15px 25px">
        <a href="{BRAND['app_store_url']}" target="_blank" style="display:inline-block;padding:15px 25px;border:1px solid {BRAND['primary_deep']};border-radius:16px;font-family:{FONT_SANS};font-size:16px;line-height:24px;font-weight:700;text-decoration:none;color:#FFF8F2;mso-padding-alt:0">Update Chunk&nbsp; &#8599;</a>
      </td></tr></table>'''


def get_chunk_260_email():
    """Return (subject, HTML, plain text); never makes network requests."""
    shortcut_rows = []
    for index in (0, 2):
        cells = []
        for title, copy in SHORTCUTS[index:index + 2]:
            cells.append(f'''<td class="shortcut-cell surface-card" width="50%" valign="top" bgcolor="{BRAND['surface_elevated']}" style="width:50%;padding:20px;background-color:{BRAND['surface_elevated']};border-radius:16px">
              <h3 class="text-dark" style="margin:0 0 8px;font-family:{FONT_SANS};font-size:16px;line-height:1.3;font-weight:700;color:{BRAND['text_primary']}">{escape(title)}</h3>
              {_p(copy, small=True)}
            </td>''')
        shortcut_rows.append('<tr>' + '<td class="grid-gap" width="12" style="width:12px;font-size:0">&nbsp;</td>'.join(cells) + '</tr>')
    shortcut_grid = '<tr><td colspan="3" height="12" style="height:12px;font-size:0">&nbsp;</td></tr>'.join(shortcut_rows)

    feature_rows = []
    for title, copy, badge in FEATURES:
        badge_html = (
            f'<p class="dm-ember" style="margin:0 0 9px;font-family:{FONT_SANS};font-size:13px;'
            f'font-weight:700;color:{BRAND["primary_deep"]}">{escape(badge)}</p>'
            if badge else ''
        )
        feature_rows.append(f'''<tr><td class="feature-rule" style="padding:24px 0;border-top:1px solid #E5DCCE">
          {badge_html}{_h2(title, 24)}{_p(copy)}
        </td></tr>''')

    html = f'''<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{escape(SUBJECT)}</title>
  <!--[if !mso]><!--><link href="{escape(GOOGLE_FONTS_URL, quote=True)}" rel="stylesheet"><!--<![endif]-->
  <style>
    :root {{ color-scheme:light dark; supported-color-schemes:light dark; }}
    body {{ margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }}
    table, td {{ mso-table-lspace:0pt; mso-table-rspace:0pt; }}
    img {{ border:0; display:block; height:auto; }}
    a[x-apple-data-detectors] {{ color:inherit !important; text-decoration:none !important; }}
    @media screen and (max-width:600px) {{
      .outer-pad {{ padding:12px 8px !important; }}
      .section-pad {{ padding-left:24px !important; padding-right:24px !important; }}
      .hero-title {{ font-size:36px !important; }}
      .split-col {{ display:block !important; width:100% !important; box-sizing:border-box; }}
      .split-copy {{ padding-right:0 !important; padding-bottom:28px !important; }}
      .screenshot {{ width:240px !important; max-width:100% !important; }}
      .shortcut-grid, .shortcut-grid tbody, .shortcut-grid tr {{ display:block !important; width:100% !important; }}
      .shortcut-cell {{ display:block !important; width:100% !important; box-sizing:border-box; }}
      .grid-gap {{ display:block !important; width:100% !important; height:12px !important; }}
      .close-title {{ font-size:29px !important; }}
    }}
    @media (prefers-color-scheme:dark) {{
      .email-wrapper {{ background-color:#1B140C !important; }}
      .email-card, .email-body {{ background-color:#241B12 !important; }}
      .email-card {{ border-color:#4A3B2B !important; }}
      .hero-light, .surface-card {{ background-color:#2F251A !important; }}
      .text-dark {{ color:#F6EFE4 !important; }}
      .text-muted-dm {{ color:#C9B89F !important; }}
      .dm-ember {{ color:#FF6A42 !important; }}
      .privacy-card {{ background-color:#26301F !important; }}
      .privacy-title {{ color:#A9C8A4 !important; }}
      .feature-rule {{ border-color:#4A3B2B !important; }}
      .email-footer {{ background-color:#1B140C !important; }}
    }}
    [data-ogsc] .text-dark {{ color:#F6EFE4 !important; }}
    [data-ogsc] .text-muted-dm {{ color:#C9B89F !important; }}
    [data-ogsc] .email-card, [data-ogsc] .email-body {{ background-color:#241B12 !important; }}
    [data-ogsc] .hero-light, [data-ogsc] .surface-card {{ background-color:#2F251A !important; }}
    [data-ogsc] .dm-ember {{ color:#FF6A42 !important; }}
    [data-ogsc] .privacy-card {{ background-color:#26301F !important; }}
    [data-ogsc] .privacy-title {{ color:#A9C8A4 !important; }}
  </style>
</head>
<body class="email-wrapper" style="margin:0;padding:0;background-color:{BRAND['bg_light']};font-family:{FONT_SANS}">
  <div style="display:none!important;visibility:hidden;mso-hide:all;max-height:0;max-width:0;opacity:0;overflow:hidden;font-size:1px;line-height:1px">{escape(PREHEADER)}</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" class="email-wrapper" bgcolor="{BRAND['bg_light']}" style="background-color:{BRAND['bg_light']}">
    <tr><td align="center" class="outer-pad" style="padding:32px 16px">
      <!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
      <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" class="email-card" bgcolor="{BRAND['card']}" style="width:100%;max-width:600px;background-color:{BRAND['card']};border:1px solid #E5DCCE;border-radius:24px;border-spacing:0;overflow:hidden">
        <tr><td class="hero-light section-pad" bgcolor="{BRAND['bg_light']}" style="padding:32px 40px 36px;background-color:{BRAND['bg_light']};border-radius:24px 24px 0 0">
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr><td><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
              <td width="34"><a href="https://www.chunkapp.com" target="_blank" aria-label="Chunk website"><img src="{MARK_URL}" alt="" width="30" height="30" style="width:30px;height:30px"></a></td>
              <td class="text-dark" style="padding-left:8px;font-family:{FONT_SANS};font-size:23px;font-weight:700;letter-spacing:-0.6px;color:{BRAND['text_primary']}">Chunk</td>
            </tr></table></td><td align="right" class="text-muted-dm" style="font-family:{FONT_MONO};font-size:13px;color:{BRAND['text_faint']}">2.6.0</td></tr>
          </table>
          <p class="dm-ember" style="margin:34px 0 14px;font-family:{FONT_SANS};font-size:12px;line-height:1.5;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:{BRAND['primary_deep']}">New for iOS &amp; macOS 27</p>
          <h1 class="hero-title text-dark" style="margin:0 0 20px;font-family:{FONT_SERIF};font-size:44px;line-height:1.08;letter-spacing:-0.025em;font-weight:600;color:{BRAND['text_primary']}">Siri, Spotlight<br>&amp; Shortcuts.<br><span class="dm-ember" style="color:{BRAND['primary_deep']}">Now in Chunk.</span></h1>
          {_p(INTRO, margin='0 0 24px')}
          {_button()}
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td class="feature-rule" style="border-top:1px solid #E5DCCE;padding-top:18px">
            {_p(REQUIREMENTS, small=True)}
          </td></tr></table>
        </td></tr>
        <tr><td class="email-body section-pad" style="padding:36px 40px 28px;background-color:{BRAND['card']}">
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr><td class="split-col split-copy" valign="top" width="56%" style="width:56%;padding-right:24px">
              {_h2('Your saved work, within reach.')}
              {_p(FIND_COPY, margin='0 0 22px')}
              <h3 class="text-dark" style="margin:0 0 8px;font-family:{FONT_SANS};font-size:17px;line-height:1.4;font-weight:700;color:{BRAND['text_primary']}">Talk to your notes.</h3>
              {_p(VOICE_COPY)}
            </td><td class="split-col" width="44%" valign="top" align="center" style="width:44%">
              <a href="{SCREENSHOT_URL}" target="_blank" aria-label="View the full-size Siri and Spotlight Settings screenshot" style="text-decoration:none;color:{BRAND['primary_deep']}"><img class="screenshot text-muted-dm" src="{SCREENSHOT_URL}" width="214" alt="Chunk Settings → Integrations: the Siri &amp; Spotlight switch and Chunk shortcuts button." style="display:block;width:214px;max-width:100%;height:auto;border:1px solid #D4C7B5;border-radius:24px;font-family:{FONT_SANS};font-size:14px;line-height:1.5;color:{BRAND['text_muted']}"></a>
              <p class="text-muted-dm" style="margin:12px 0 0;font-family:{FONT_SANS};font-size:13px;line-height:1.5;color:{BRAND['text_faint']}">Your controls, on every device.<br><a class="dm-ember" href="{SCREENSHOT_URL}" target="_blank" style="color:{BRAND['primary_deep']};text-decoration:underline">View full size &#8599;</a></p>
            </td></tr>
          </table>
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td class="privacy-card" bgcolor="#E2EDDF" style="padding:20px 22px;background-color:#E2EDDF;border-radius:16px">
            <p class="privacy-title" style="margin:0 0 8px;font-family:{FONT_SANS};font-size:16px;line-height:1.4;font-weight:700;color:#477349">Your memories are never indexed.</p>
            {_p(CONTROL_COPY, small=True, color=BRAND['text_primary'], css='text-dark')}
          </td></tr></table>
        </td></tr>
        <tr><td class="email-body section-pad" style="padding:8px 40px 36px;background-color:{BRAND['card']}">
          {_h2('Make it a Shortcut.')}
          {_p('Four starting points. Eleven ways to put Chunk to work.', margin='0 0 18px')}
          <table class="shortcut-grid" role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout:fixed">{shortcut_grid}</table>
          {_p(SHORTCUTS_NOTE, small=True, margin='18px 0 10px')}
          {_p(SAVE_NOTE, small=True)}
        </td></tr>
        <tr><td class="hero-light section-pad" bgcolor="{BRAND['bg_light']}" style="padding:32px 40px 8px;background-color:{BRAND['bg_light']}">
          <p class="dm-ember" style="margin:0 0 20px;font-family:{FONT_SANS};font-size:12px;line-height:1.5;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:{BRAND['primary_deep']}">Also new in Chunk 2.6.0</p>
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">{''.join(feature_rows)}</table>
        </td></tr>
        <tr><td class="email-body section-pad" align="center" style="padding:36px 40px 40px;background-color:{BRAND['card']}">
          <h2 class="close-title text-dark" style="margin:0 0 10px;font-family:{FONT_SERIF};font-size:32px;line-height:1.15;font-weight:600;letter-spacing:-0.015em;color:{BRAND['text_primary']}">Your next idea is waiting.</h2>
          {_p('Update to Chunk 2.6.0 and make it yours.', margin='0 0 22px')}
          {_button()}
          <p style="margin:20px 0 0;font-family:{FONT_SANS};font-size:14px;line-height:1.6"><a class="dm-ember" href="{DETAILS_URL}" target="_blank" style="color:{BRAND['primary_deep']};text-decoration:underline">Explore Siri, Spotlight &amp; Shortcuts &#8599;</a></p>
        </td></tr>
        <tr><td class="email-footer section-pad" bgcolor="{BRAND['bg_dark']}" align="center" style="padding:28px 40px;background-color:{BRAND['bg_dark']};border-radius:0 0 24px 24px">
          <p style="margin:0 0 12px;font-family:{FONT_SANS};font-size:14px;line-height:1.6;color:{BRAND['text_muted_dark']}">Questions? Just reply—we read everything.</p>
          <p style="margin:0 0 14px;font-family:{FONT_SANS};font-size:13px;line-height:1.6;color:{BRAND['text_muted_dark']}">Chunk · Made for curious minds.<br>&copy; 2026 Curious Minds Software, LLC</p>
          <p style="margin:0;font-family:{FONT_SANS};font-size:13px;line-height:1.7;color:{BRAND['text_muted_dark']}"><a href="{UNSUBSCRIBE}" style="color:{BRAND['primary_light']};text-decoration:underline">Unsubscribe</a>&nbsp; · &nbsp;<a href="{BRAND['privacy_url']}" style="color:{BRAND['primary_light']};text-decoration:underline">Privacy</a>&nbsp; · &nbsp;<a href="{BRAND['terms_url']}" style="color:{BRAND['primary_light']};text-decoration:underline">Terms</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>
'''

    sections = [
        SUBJECT, PREHEADER, "Siri, Spotlight & Shortcuts. Now in Chunk.", INTRO,
        f"Update Chunk: {BRAND['app_store_url']}", REQUIREMENTS,
        "YOUR SAVED WORK, WITHIN REACH\n" + FIND_COPY,
        "Talk to your notes.\n" + VOICE_COPY,
        "Your memories are never indexed.\n" + CONTROL_COPY,
        "View the Siri & Spotlight Settings screenshot: " + SCREENSHOT_URL,
        "MAKE IT A SHORTCUT\nFour starting points. Eleven ways to put Chunk to work.\n"
        + "\n".join(f"- {title}: {copy}" for title, copy in SHORTCUTS),
        SHORTCUTS_NOTE, SAVE_NOTE, "ALSO NEW IN CHUNK 2.6.0",
    ]
    sections.extend(
        title + (f" ({badge})" if badge else "") + "\n" + copy
        for title, copy, badge in FEATURES
    )
    sections.extend([
        "Your next idea is waiting.\nUpdate to Chunk 2.6.0 and make it yours.",
        f"Update Chunk: {BRAND['app_store_url']}",
        "Explore Siri, Spotlight & Shortcuts: " + DETAILS_URL,
        "Questions? Just reply—we read everything.\ninfo@chunkapp.com",
        "Chunk · Made for curious minds.\n© 2026 Curious Minds Software, LLC",
        f"Unsubscribe: {UNSUBSCRIBE}\nPrivacy: {BRAND['privacy_url']}\nTerms: {BRAND['terms_url']}",
    ])
    return SUBJECT, html, "\n\n".join(sections) + "\n"
