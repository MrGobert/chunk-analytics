"""
Email Service for Chunk AI
Uses Resend API to send transactional and marketing emails.

Design System: "Paper & Ember" (Chunk Design System v2) — warm paper surfaces, one ember of orange.
Typography: Fraunces 600 (display serif), DM Sans (body/UI), Spline Sans Mono (fine print/data)
Colors: paper #FAF5EE, card #FFFDF8, ink #2D2418, ember #E84D2B, night #241B12 (dark sections, warm espresso)
Content-type coding: Notes ember #E84D2B, Documents lake #3E7CB1, URLs sage #5B8A5E, Reports butter #F5BE4F, Chats ink-soft #6B5D4F
"""

import logging
import os
from typing import Optional

import httpx

logging.basicConfig(level=logging.INFO)

# Resend Configuration
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_API_URL = "https://api.resend.com/emails"
FROM_EMAIL = "Chunk AI <info@chunkapp.com>"

# Brand colors and assets — "Paper & Ember" Design System (Chunk Design System v2)
BRAND = {
    # Core palette
    "primary": "#E84D2B",          # ember — CTAs, the one point of heat
    "primary_light": "#FF6A42",    # ember-bright — small orange text/icons on night
    "primary_deep": "#BD3717",     # ember-deep — small orange text/links on paper
    "bg_dark": "#241B12",          # night — warm espresso, never cold gray
    "bg_light": "#FAF5EE",         # paper
    "surface": "rgba(45,36,24,0.10)",   # line — hairline borders (borders only, never bgcolor=)
    "surface_dark": "#2F251A",     # night-soft — cards on night
    "surface_elevated": "#F3EADC", # paper-deep — inset card fills
    "card": "#FFFDF8",             # card surfaces
    "text_primary": "#2D2418",     # ink
    "text_inverse": "#F6EFE4",     # cream — primary text on night
    "text_muted": "#6B5D4F",       # ink-soft
    "text_faint": "#776550",       # ink-faint — mono fine print
    "text_muted_dark": "#C9B89F",  # cream-soft — secondary text on night
    # Accent colors
    "accent_blue": "#3E7CB1",      # lake
    "accent_blue_dark": "#BD3717", # small links are ember-deep in Paper & Ember
    "signal_green": "#5B8A5E",     # sage — fills, dots, large accents
    "sage_deep": "#477349",        # small green text (AA on paper)
    "gold": "#F5BE4F",             # butter — fills/dots/strips only, never text
    "butter_deep": "#8F6A1C",      # small gold-family text
    "purple": "#5B8A5E",           # no purple in Paper & Ember — mapped to sage
    # Content-type colors
    "color_notes": "#E84D2B",         # ember
    "color_documents": "#3E7CB1",     # lake
    "color_urls": "#5B8A5E",          # sage
    "color_reports": "#F5BE4F",       # butter (text positions use butter_deep)
    "color_conversations": "#6B5D4F", # ink-soft — chats are words
    # Gradient — retired in Paper & Ember; key kept (broadcast scripts import it)
    "gradient": "#E84D2B",
    "night_line": "rgba(250,245,238,0.10)",  # hairline borders on night
    # Assets — logos
    "logo_dark_url": "https://chunkapp.com/chunk-logo-dot.png",      # Dark text logo — for light backgrounds
    "logo_light_url": "https://chunkapp.com/chunk-logo-white.png",    # White text logo — for dark backgrounds
    "logo_url": "https://chunkapp.com/chunk_gradient_logo.png",       # Legacy fallback
    "app_store_url": "https://apps.apple.com/us/app/chunk-ai-research-assistant/id6472682763",
    "login_url": "https://www.chunkapp.com/login",
    "privacy_url": "https://www.chunkapp.com/privacy",
    "terms_url": "https://www.chunkapp.com/tos",
    "web_url": "https://chunkapp.com",
    "notes_url": "https://chunkapp.com/features/notes",
    "collections_url": "https://chunkapp.com/features/collections",
    "monitors_url": "https://chunkapp.com/features/automations",
    "guide_url": "https://chunkapp.com/help",
}

# Google Fonts URL for email — Fraunces 600 only (never emit font-weight:700 on serif)
GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,600&family=DM+Sans:wght@400;500;700&family=Spline+Sans+Mono:wght@400;500&display=swap"

# Font stacks
FONT_SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
FONT_SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"
FONT_MONO = "'Spline Sans Mono', 'SF Mono', 'Fira Code', Consolas, monospace"


# ============================================================
# Template Building Blocks
# ============================================================

# Fill accents → AA-safe variants for small text (labels, attributions, stat values).
# Butter/sage/ember are fill colors in Paper & Ember; their text positions use deep variants.
_TEXT_SAFE = {
    "#E84D2B": "#BD3717",  # ember → ember-deep
    "#F5BE4F": "#8F6A1C",  # butter → butter-deep
    "#5B8A5E": "#477349",  # sage → sage-deep
}


def _text_accent(color: str) -> str:
    """Return the AA-safe text variant of a fill accent (pass-through for already-safe colors)."""
    return _TEXT_SAFE.get(color, color)


# Accent text → dark-mode class (deep accents are too dim on night surfaces)
_DM_ACCENT_CLASS = {
    "#BD3717": "dm-ember",
    "#8F6A1C": "dm-butter",
    "#477349": "dm-sage",
    "#3E7CB1": "dm-lake",
    "#6B5D4F": "dm-ink",
}


def _accent_class(color: str) -> str:
    """Dark-mode lightening class for an accent color (accepts fill or text variant)."""
    return _DM_ACCENT_CLASS.get(_TEXT_SAFE.get(color, color), "")


def _base_email_template(
    preheader: str,
    hero_title: str,
    hero_subtitle: str,
    body_content: str,
    cta_text: Optional[str] = None,
    cta_url: Optional[str] = None,
    footer_tip: Optional[str] = None,
    hero_dark: bool = True,
    hero_label: Optional[str] = None,
    hero_serif_word: Optional[str] = None,
) -> str:
    """
    Generate base email HTML template using the Paper & Ember design system.

    hero_dark: If True, hero uses the night bg (#241B12, "Ember at Night"). If False, paper-deep (#F3EADC).
    hero_label: Optional eyebrow label above the title (e.g., "WELCOME SEQUENCE · DAY 1").
    hero_serif_word: If provided, this word in the hero_title gets the italic-ember "wonk" treatment.
    """
    hero_bg = BRAND["bg_dark"] if hero_dark else BRAND["surface_elevated"]
    hero_text = BRAND["text_inverse"] if hero_dark else BRAND["text_primary"]
    hero_sub_text = BRAND["text_muted_dark"] if hero_dark else BRAND["text_muted"]
    hero_logo = BRAND["logo_light_url"] if hero_dark else BRAND["logo_dark_url"]
    hero_eyebrow = BRAND["primary_light"] if hero_dark else BRAND["primary_deep"]

    # Process hero_serif_word if provided — the one italic-ember accent word per headline
    title_html = hero_title
    if hero_serif_word and hero_serif_word in hero_title:
        title_html = hero_title.replace(
            hero_serif_word,
            f'<span style="font-style:italic;color:{BRAND["primary"]}">{hero_serif_word}</span>'
        )

    label_html = ""
    if hero_label:
        label_html = f"""
        <tr>
            <td align="center" style="padding:0 40px 16px 40px">
                <p style="margin:0;font-family:{FONT_SANS};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{hero_eyebrow};font-weight:700">{hero_label}</p>
            </td>
        </tr>
        """

    cta_section = ""
    if cta_text and cta_url:
        cta_section = f"""
        <tr>
            <td align="center" style="padding:32px 40px 16px 40px">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                        <td style="padding:16px 28px;background-color:{BRAND['primary']};border-radius:16px;box-shadow:0 8px 28px rgba(232,77,43,0.28);mso-padding-alt:0" class="cta-btn">
                            <a href="{cta_url}" style="color:#FFF8F2;font-family:{FONT_SANS};font-weight:700;text-decoration:none;font-size:16px;display:inline-block;line-height:24px" target="_blank">{cta_text}</a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        """

    tip_section = ""
    if footer_tip:
        tip_section = f"""
        <tr>
            <td style="padding:0">
                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#FBEFD4;border-top:1px solid {BRAND['surface']}" class="tip-card">
                    <tr>
                        <td style="padding:24px 40px">
                            <table width="100%" border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="width:4px;background-color:{BRAND['gold']};border-radius:2px" width="4"></td>
                                    <td style="padding-left:16px">
                                        <p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{BRAND['butter_deep']};font-weight:700" class="tip-label">Quick Tip</p>
                                        <p style="margin:0;font-family:{FONT_SANS};color:{BRAND['text_primary']};font-size:14px;line-height:1.6" class="text-dark">{footer_tip}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        """

    return f"""<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>{hero_title}</title>
    <link href="{GOOGLE_FONTS_URL}" rel="stylesheet">
    <!--[if !mso]><!-->
    <style>
        @import url('{GOOGLE_FONTS_URL}');
    </style>
    <!--<![endif]-->
    <style>
        :root {{ color-scheme: light dark; supported-color-schemes: light dark; }}
        body {{ margin:0; padding:0; }}
        table {{ border-collapse:collapse; }}
        img {{ border:0; display:block; }}
        a {{ color:{BRAND['primary']}; }}
        .preheader {{ display:none !important; visibility:hidden; mso-hide:all; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; }}

        /* ---- Dark Mode: "Ember at Night" — warm espresso, never cold gray ---- */
        @media (prefers-color-scheme: dark) {{
            /* Outer wrapper — one step deeper than night */
            .email-wrapper {{ background-color: #1B140C !important; }}
            /* Main card */
            .email-card {{ background-color: #241B12 !important; }}
            /* Body content area */
            .email-body {{ background-color: #241B12 !important; }}
            /* Paper hero variant */
            .hero-light {{ background-color: #2F251A !important; }}
            /* Elevated surface cards (feature cards, stat blocks, quote cards) */
            .surface-card {{ background-color: #2F251A !important; }}
            /* Ink text → cream */
            .text-dark {{ color: #F6EFE4 !important; }}
            /* Muted text → cream-soft */
            .text-muted-dm {{ color: #C9B89F !important; }}
            /* Platform badge area */
            .platform-badge {{ background-color: #241B12 !important; }}
            /* Night cards get night-soft so they stay distinct from the body */
            .dark-card {{ background-color: #2F251A !important; border-color: rgba(250,245,238,0.10) !important; }}
            /* CTA stays ember */
            .cta-btn {{ background-color: {BRAND['primary']} !important; }}
            /* Night banner blends up one step */
            .ember-banner {{ background-color: #2F251A !important; }}
            /* Footer drops to wrapper depth */
            .email-footer {{ background-color: #1B140C !important; }}
            /* Sage CTA cards — warm dark sage */
            .green-card {{ background-color: #26301F !important; }}
            .green-card-title {{ color: #A9C8A4 !important; }}
            /* Butter sticky-note tip */
            .tip-card {{ background-color: #2F251A !important; }}
            .tip-label {{ color: {BRAND['gold']} !important; }}
            /* Billing warning card */
            .warn-card {{ background-color: #332612 !important; }}
            .warn-title {{ color: {BRAND['gold']} !important; }}
            /* Deep accent text lightens on night surfaces */
            .dm-ember {{ color: #FF6A42 !important; }}
            .dm-butter {{ color: {BRAND['gold']} !important; }}
            .dm-sage {{ color: #A9C8A4 !important; }}
            .dm-lake {{ color: #9CC0DE !important; }}
            .dm-ink {{ color: #C9B89F !important; }}
        }}
    </style>
</head>
<body style="margin:0;padding:0;background-color:{BRAND['bg_light']};font-family:{FONT_SANS}" class="email-wrapper">
    <!-- Preheader -->
    <div class="preheader" style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">{preheader}</div>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:{BRAND['bg_light']}" class="email-wrapper">
        <tr>
            <td align="center" style="padding:40px 20px">
                <table width="600" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:{BRAND['card']};border:1px solid {BRAND['surface']};border-radius:24px;overflow:hidden;box-shadow:0 1px 2px rgba(45,36,24,0.06),0 8px 24px rgba(93,64,28,0.08)" class="email-card">

                    <!-- Ember Bar — the one stripe of heat -->
                    <tr>
                        <td style="height:4px;background-color:{BRAND['primary']};font-size:0;line-height:0">&nbsp;</td>
                    </tr>

                    <!-- Hero Section -->
                    <tr>
                        <td style="background-color:{hero_bg};padding:48px 40px 40px 40px" class="{'dark-card' if hero_dark else 'hero-light'}">
                            <table width="100%" border="0" cellpadding="0" cellspacing="0">
                                <!-- Logo -->
                                <tr>
                                    <td align="center" style="padding-bottom:32px">
                                        <img src="{hero_logo}" alt="Chunk" width="140" style="display:block;border:none;width:140px;max-width:140px">
                                    </td>
                                </tr>
                                {label_html}
                                <!-- Title -->
                                <tr>
                                    <td align="center" style="padding:0 0 12px 0">
                                        <h1 style="margin:0;font-family:{FONT_SERIF};font-size:34px;font-weight:600;color:{hero_text};letter-spacing:-0.015em;line-height:1.1" class="{'text-dark' if not hero_dark else ''}">{title_html}</h1>
                                    </td>
                                </tr>
                                <!-- Subtitle -->
                                <tr>
                                    <td align="center" style="padding:0">
                                        <p style="margin:0;font-family:{FONT_SANS};font-size:16px;color:{hero_sub_text};line-height:1.6" class="{'text-muted-dm' if not hero_dark else ''}">{hero_subtitle}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding:32px 40px 8px 40px;background-color:{BRAND['card']}" class="email-body">
                            {body_content}
                        </td>
                    </tr>

                    {cta_section}

                    <!-- Platform Badge + Website Link -->
                    <tr>
                        <td align="center" style="padding:16px 40px 8px 40px;background-color:{BRAND['card']}" class="platform-badge">
                            <p style="margin:0;font-family:{FONT_MONO};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_faint']}">
                                iOS · macOS · visionOS · Web
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding:0 40px 32px 40px;background-color:{BRAND['card']}" class="platform-badge">
                            <p style="margin:0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_muted']}" class="text-muted-dm">
                                Visit: <a href="https://www.chunkapp.com" style="color:{BRAND['primary_deep']};text-decoration:none;font-weight:700">chunkapp.com</a>
                            </p>
                        </td>
                    </tr>

                    {tip_section}

                    <!-- Footer -->
                    <tr>
                        <td style="padding:32px 40px;background-color:{BRAND['bg_dark']}" class="email-footer">
                            <table width="100%" border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="padding-bottom:16px">
                                        <p style="margin:0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_muted_dark']}">Questions? Just reply — we read everything.</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding-bottom:16px">
                                        <p style="margin:0;font-family:{FONT_MONO};font-size:11px;color:rgba(246,239,228,0.45);letter-spacing:0.05em">&copy; 2026 Chunk AI</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center">
                                        <p style="margin:0;font-family:{FONT_SANS};font-size:13px;color:{BRAND['text_muted_dark']}">
                                            {{UNSUBSCRIBE_LINK_PLACEHOLDER}}
                                            <a href="{BRAND['privacy_url']}" style="color:{BRAND['primary_light']};text-decoration:none">Privacy</a>
                                            <span style="color:rgba(246,239,228,0.45)"> · </span>
                                            <a href="{BRAND['terms_url']}" style="color:{BRAND['primary_light']};text-decoration:none">Terms</a>
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""


def _feature_card(
    emoji: str,
    title: str,
    description: str,
    accent_color: str,
    mono_label: Optional[str] = None,
) -> str:
    """
    Generate a feature card with content-type color accent strip.
    Paper-deep fill with a hairline border — paper objects have edges.
    """
    label_html = ""
    if mono_label:
        label_html = f'<p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:{_text_accent(accent_color)};font-weight:700" class="{_accent_class(accent_color)}">{mono_label}</p>'

    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:12px;background-color:{BRAND['surface_elevated']};border:1px solid {BRAND['surface']};border-radius:16px;overflow:hidden" class="surface-card">
        <tr>
            <td style="width:6px;background-color:{accent_color}" width="6"></td>
            <td style="padding:20px">
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="width:40px;vertical-align:top;padding-right:14px;font-size:24px;line-height:40px" width="40">{emoji}</td>
                        <td style="vertical-align:top">
                            {label_html}
                            <p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_primary']};font-size:16px;letter-spacing:-0.01em" class="text-dark">{title}</p>
                            <p style="margin:0;font-family:{FONT_SANS};color:{BRAND['text_muted']};font-size:14px;line-height:1.5" class="text-muted-dm">{description}</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    """


def _dark_card(content: str) -> str:
    """A night-background card block — an "Ember at Night" moment for emphasis."""
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:16px;background-color:{BRAND['bg_dark']};border-radius:16px;border:1px solid {BRAND['night_line']};overflow:hidden" class="dark-card">
        <tr>
            <td style="padding:24px">
                {content}
            </td>
        </tr>
    </table>
    """


def _protocol_step(number: str, title: str, description: str) -> str:
    """Numbered step — Fraunces display numeral in ember (display-size orange is allowed)."""
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:16px">
        <tr>
            <td style="width:48px;vertical-align:top;padding-right:12px" width="48">
                <p style="margin:0;font-family:{FONT_SERIF};font-size:22px;font-weight:600;color:{BRAND['primary']};line-height:1">{number}</p>
            </td>
            <td style="vertical-align:top">
                <p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_primary']};font-size:18px;letter-spacing:-0.02em" class="text-dark">{title}</p>
                <p style="margin:0;font-family:{FONT_SANS};color:{BRAND['text_muted']};font-size:14px;line-height:1.6" class="text-muted-dm">{description}</p>
            </td>
        </tr>
    </table>
    """


def _stat_block(value: str, label: str, color: str) -> str:
    """A stat display block — Fraunces display numeral + mono label, chip radius."""
    return f"""
    <td style="padding:16px;background-color:{BRAND['surface_elevated']};border:1px solid {BRAND['surface']};border-radius:10px;text-align:center" class="surface-card">
        <p style="margin:0;font-family:{FONT_SERIF};font-size:28px;font-weight:600;color:{_text_accent(color)};letter-spacing:-0.02em" class="{_accent_class(color)}">{value}</p>
        <p style="margin:4px 0 0 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_faint']}" class="text-muted-dm">{label}</p>
    </td>
    """


def _quote_card(quote: str, attribution: str, accent_color: str) -> str:
    """A testimonial/quote card with left accent strip — the quote is a serif moment."""
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:12px;background-color:{BRAND['surface_elevated']};border:1px solid {BRAND['surface']};border-radius:16px;overflow:hidden" class="surface-card">
        <tr>
            <td style="width:4px;background-color:{accent_color}" width="4"></td>
            <td style="padding:20px 24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SERIF};font-size:17px;font-weight:600;color:{BRAND['text_primary']};font-style:italic;line-height:1.5" class="text-dark">"{quote}"</p>
                <p style="margin:0;font-family:{FONT_SANS};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{_text_accent(accent_color)};font-weight:700" class="{_accent_class(accent_color)}">{attribution}</p>
            </td>
        </tr>
    </table>
    """


def _serif_statement(text: str, highlight: Optional[str] = None) -> str:
    """A big Fraunces statement — upright, with the one italic-ember accent word (the "wonk" move)."""
    display_text = text
    if highlight and highlight in text:
        display_text = text.replace(
            highlight,
            f'<span style="font-style:italic;color:{BRAND["primary"]}">{highlight}</span>'
        )
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px">
        <tr>
            <td align="center" style="padding:8px 0">
                <p style="margin:0;font-family:{FONT_SERIF};font-weight:600;font-size:26px;color:{BRAND['text_primary']};line-height:1.15;text-align:center" class="text-dark">{display_text}</p>
            </td>
        </tr>
    </table>
    """


def _gradient_banner(headline: str, subline: str, detail: Optional[str] = None) -> str:
    """A full-width night banner — the gradient is retired; this is now an "Ember at Night" moment.

    (Keeps its historical name so the ~7 call sites don't change.)
    """
    detail_html = ""
    if detail:
        detail_html = f'<p style="margin:8px 0 0 0;font-family:{FONT_MONO};font-size:12px;color:rgba(246,239,228,0.5)">{detail}</p>'
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;background-color:{BRAND['bg_dark']};border:1px solid {BRAND['night_line']};border-radius:16px;overflow:hidden" class="ember-banner">
        <tr>
            <td align="center" style="padding:32px 24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SERIF};font-size:22px;font-weight:600;color:{BRAND['text_inverse']};letter-spacing:-0.015em">{headline}</p>
                <p style="margin:0;font-family:{FONT_SANS};font-size:15px;color:{BRAND['text_muted_dark']}">{subline}</p>
                {detail_html}
            </td>
        </tr>
    </table>
    """


def _content_type_legend() -> str:
    """Visual legend showing Chunk's content-type color coding — used in Collections-related emails."""
    types = [
        ("📝", "Notes", BRAND["color_notes"]),
        ("📄", "Documents", BRAND["color_documents"]),
        ("🔗", "URLs", BRAND["color_urls"]),
        ("🧪", "Reports", BRAND["color_reports"]),
        ("💬", "Chats", BRAND["color_conversations"]),
    ]
    cells = ""
    for emoji, label, color in types:
        cells += f"""
        <td style="text-align:center;padding:8px 4px">
            <div style="width:8px;height:8px;border-radius:50%;background-color:{color};margin:0 auto 4px auto"></div>
            <p style="margin:0;font-family:{FONT_MONO};font-size:9px;letter-spacing:0.08em;color:{BRAND['text_faint']}">{emoji} {label}</p>
        </td>
        """
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px">
        <tr>{cells}</tr>
    </table>
    """


# ============================================================
# Email Templates
# ============================================================


def get_welcome_email(user_name: str = "there") -> tuple[str, str, str]:
    """
    Instant welcome email — sent immediately on signup.
    Warm, concise, and curiosity-driven. Introduces the 5 core value props
    without deep-diving any single one (the drip campaign handles depth).
    Layout: hero → personal greeting → feature teasers as a compact grid → single CTA.
    """
    subject = "Welcome to Chunk ⚡"

    # Feature teaser cards — short, curiosity-sparking descriptions
    features_html = ""

    # Each feature as a compact, elegant row with accent dot + one-liner
    feature_items = [
        (BRAND["color_conversations"], "MODELS", "🧠", "Every Top AI Model",
         "GPT-5, Claude, Gemini — switch per conversation. One app, every model."),
        (BRAND["color_documents"], "COLLECTIONS", "📚", "Collections",
         "Gather notes, docs, and URLs into one workspace. Ask AI across all of it."),
        (BRAND["color_reports"], "ARTIFACTS", "🧪", "Artifacts",
         "Turn audio lectures, podcasts, YouTube videos, and PDFs into searchable transcripts, study guides, and more."),
        (BRAND["color_notes"], "NOTES", "📝", "Connected Notes + Graph",
         "Wiki-link your ideas with [[brackets]] and watch a living knowledge graph reveal how they connect."),
        (BRAND["color_urls"], "AUTOMATIONS", "📡", "Automations",
         "Research on autopilot. Standing agents re-run your query on a schedule and deliver a cited what's-new digest."),
        (BRAND["accent_blue"], "CAPTURE", "📥", "Share to Chunk",
         "Save anything from anywhere — the share sheet on iPhone, iPad & Mac, the browser clipper, or forward any email. AI files it in your Inbox."),
    ]

    for color, label, emoji, title, desc in feature_items:
        features_html += f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:8px;background-color:{BRAND['surface_elevated']};border-radius:12px;overflow:hidden" class="surface-card">
        <tr>
            <td style="width:4px;background-color:{color}" width="4"></td>
            <td style="padding:16px 18px">
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="width:32px;vertical-align:top;padding-right:12px;font-size:20px;line-height:32px" width="32">{emoji}</td>
                        <td style="vertical-align:top">
                            <p style="margin:0 0 2px 0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_primary']};font-size:15px;letter-spacing:-0.01em" class="text-dark">{title}</p>
                            <p style="margin:0;font-family:{FONT_SANS};color:{BRAND['text_muted']};font-size:13px;line-height:1.5" class="text-muted-dm">{desc}</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    """

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Welcome to Chunk — your AI-powered research workspace. Here's what's at your fingertips:
    </p>

    {features_html}

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0 0">
        <tr>
            <td align="center" style="padding:8px 0">
                <p style="margin:0;font-family:{FONT_SERIF};font-weight:600;font-size:24px;color:{BRAND['text_primary']};line-height:1.2;text-align:center" class="text-dark">One app. Every model. All your <span style="font-style:italic;color:{BRAND['primary']}">research</span>, connected.</p>
            </td>
        </tr>
    </table>
    """

    html = _base_email_template(
        preheader="Welcome to Chunk — every top AI model, connected notes, and a research workspace that thinks with you.",
        hero_title="Welcome to Chunk",
        hero_subtitle="Your AI research workspace is ready.",
        body_content=body,
        cta_text="Start Exploring",
        cta_url=BRAND["web_url"] + "/chat?source=welcome_email",
        footer_tip="Try this: type [[ in any note to create a wiki link. Your ideas start connecting themselves.",
        hero_dark=True,
        hero_label="WELCOME",
        hero_serif_word="Chunk",
    )

    return (
        subject,
        html,
        f"Welcome to Chunk! Your AI research workspace is ready. Every top AI model, connected notes, collections, artifacts, Automations, and Share to Chunk capture — all in one app. Get started: {BRAND['login_url']}",
    )


def get_trial_started_email(user_name: str = "there") -> tuple[str, str, str]:
    """Generate trial started email — activation focus."""
    subject = "🎉 Your Pro Trial is Active"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Your <strong>3-day Pro trial</strong> just unlocked the full Chunk research workspace. Here's what you can do right now:
    </p>
    {_feature_card("🔬", "Deep Research", "Ask any complex question — get a comprehensive, multi-source report with citations. Hours of research, compressed into minutes.", BRAND['color_reports'], "RESEARCH MODE")}
    {_feature_card("📚", "Research in Collections", "Gather notes, documents, URLs, and past chats into one Collection — then run AI research across all of it. Your sources, one workspace.", BRAND['color_documents'], "COLLECTIONS")}
    {_feature_card("📝", "Connected Notes", "Wiki-link your ideas with [[brackets]]. Watch your knowledge graph grow. AI writing tools help you think — not think for you.", BRAND['color_notes'], "NOTES")}
    {_feature_card("📡", "Automations", "Put research on autopilot — run up to 5 standing Automations on a daily cadence. Each run diffs against the last and emails you a cited what's-new digest.", BRAND['color_urls'], "AUTOMATIONS")}
    {_feature_card("🧠", "Every AI Model", "GPT-5, Claude, Gemini — switch models per conversation. The right tool for every task, one subscription.", BRAND['color_conversations'], "MULTI-MODEL")}
    <p style="margin:20px 0 0 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        <strong>Start here:</strong> Create a Collection, drop in a few sources, and ask Chunk to research across them. That's the moment it clicks.
    </p>
    """

    html = _base_email_template(
        preheader="Your 3-day Pro trial is live. Deep Research, Collections, Connected Notes — all unlocked.",
        hero_title="Your Pro Trial is Active",
        hero_subtitle="3 days of unlimited research power starts now.",
        body_content=body,
        cta_text="Open Chunk",
        cta_url=BRAND["web_url"],
        footer_tip='Create a Collection → add a few URLs or documents → ask a question. Chunk reads everything for you and synthesizes the answer.',
        hero_label="TRIAL ACTIVATED",
    )

    return (
        subject,
        html,
        f"Your 3-day Chunk Pro trial is active! Try Research in Collections at {BRAND['web_url']}",
    )


def get_trial_ending_email(
    user_name: str = "there", hours_remaining: int = 12
) -> tuple[str, str, str]:
    """Generate trial ending email — urgency + value."""
    if hours_remaining <= 24:
        subject = "⏰ Your Chunk Trial Ends Tonight"
        title = "Your Trial Ends Tonight"
        urgency = "tonight"
    else:
        days = hours_remaining // 24
        subject = f"⏰ {days} Day{'s' if days > 1 else ''} Left on Your Trial"
        title = f"{days} Day{'s' if days > 1 else ''} Left"
        urgency = f"in {days} day{'s' if days > 1 else ''}"

    losing_items = f"""
    <p style="margin:0;font-family:{FONT_MONO};font-size:13px;color:{BRAND['text_inverse']};line-height:2.2">
        <span style="color:{BRAND['color_reports']}">✕</span>&nbsp; Deep Research reports with citations<br>
        <span style="color:{BRAND['color_documents']}">✕</span>&nbsp; Research in Collections across all your sources<br>
        <span style="color:#A9C8A4">✕</span>&nbsp; Daily-cadence Automations (5 active)<br>
        <span style="color:{BRAND['primary_light']}">✕</span>&nbsp; AI-powered writing tools in Notes<br>
        <span style="color:{BRAND['signal_green']}">✕</span>&nbsp; GPT-5, Claude, Gemini model access<br>
        <span style="color:{BRAND['text_inverse']}">✕</span>&nbsp; Knowledge graph visualization
    </p>
    """

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Your Pro trial ends <strong>{urgency}</strong>. After that, you'll lose access to:
    </p>
    {_dark_card(losing_items)}
    {_gradient_banner(
        "All AI Models. One Workspace.",
        "GPT-5, Claude, Gemini & more — just <strong style='color:#FF6A42'>$5.83/month</strong> on the yearly plan.",
        "That's 90% less than paying for each model separately"
    )}
    """

    html = _base_email_template(
        preheader=f"Your Chunk Pro trial ends {urgency}. Don't lose your research superpowers.",
        hero_title=title,
        hero_subtitle="Don't lose your research superpowers.",
        body_content=body,
        cta_text="Subscribe Now",
        cta_url=BRAND["web_url"],
        hero_dark=True,
        hero_serif_word="Tonight" if hours_remaining <= 24 else None,
    )

    return (
        subject,
        html,
        f"Your Chunk Pro trial ends {urgency}. Subscribe now to keep Deep Research, Collections, and multi-model AI: {BRAND['web_url']}",
    )


def get_subscription_expired_email(user_name: str = "there") -> tuple[str, str, str]:
    """Generate subscription expired email — empathetic, door-open."""
    subject = "Your Pro Access Has Ended"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Your Chunk Pro subscription has ended. We're sorry to see you go.
    </p>
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        If there's anything we could have done better, we'd genuinely love to hear from you. Just reply to this email.
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        <strong>Your account is still active</strong> — your notes, collections, and saved research are all safe. You can still use Chunk's free features, and your Pro access is just a tap away whenever you're ready.
    </p>
    {_serif_statement("Your research is waiting for you.", "waiting for you.")}
    """

    html = _base_email_template(
        preheader="Your Pro subscription has ended. Your research and notes are still here.",
        hero_title="We're Sorry to See You Go",
        hero_subtitle="Your Pro subscription has ended.",
        body_content=body,
        cta_text="Resubscribe Anytime",
        cta_url=BRAND["web_url"],
        hero_dark=False,
    )

    return (
        subject,
        html,
        f"Your Chunk Pro subscription has ended. Your research is still here whenever you're ready: {BRAND['web_url']}",
    )


def get_winback_7day_email(user_name: str = "there") -> tuple[str, str, str]:
    """Generate 7-day winback email — value reminder."""
    subject = "Your research workspace misses you"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        It's been a week. Your collections, notes, and knowledge graph are still here — but they're missing their AI superpowers.
    </p>
    {_serif_statement("One app. Every model. All your research, connected.", "connected.")}
    {_feature_card("📚", "Research in Collections", "The feature that turns Chunk from a chat app into a research powerhouse. Gather all your sources, then synthesize across everything at once.", BRAND['color_documents'])}
    {_feature_card("📝", "Connected Notes + Knowledge Graph", "Wiki-links, backlinks, cluster detection — your ideas form a living map of connections that grows with you.", BRAND['color_notes'])}
    {_feature_card("📡", "Automations", "New since you left: standing research agents that re-run your query on a schedule and email you a cited digest of what changed.", BRAND['color_urls'], "NEW")}
    {_gradient_banner(
        "Come Back to Chunk",
        "All AI models, one research workspace — just <strong style='color:#FF6A42'>$5.83/month</strong>",
        "90% less than separate subscriptions"
    )}
    """

    html = _base_email_template(
        preheader="Your research workspace is waiting. Collections, notes, and AI — all still here.",
        hero_title="Your Research Workspace Misses You",
        hero_subtitle="Your collections and notes are waiting.",
        body_content=body,
        cta_text="Come Back to Chunk",
        cta_url=BRAND["web_url"],
        hero_dark=True,
    )

    return (
        subject,
        html,
        f"Your Chunk research workspace is waiting. All AI models, connected notes, and Collections: {BRAND['web_url']}",
    )


def get_winback_30day_email(user_name: str = "there") -> tuple[str, str, str]:
    """Generate 30-day winback email — what's new since they left."""
    subject = "A lot has changed — come see what's new"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        It's been a month since you left Chunk, and we've been building. Here's what's new:
    </p>
    {_feature_card("📡", "Automations", "Standing research agents that re-run your query on a schedule, spot what changed, and deliver a cited what's-new digest — every report filed into your knowledge base.", BRAND['color_urls'], "NEW")}
    {_feature_card("📥", "Share to Chunk", "Save anything from anywhere — the share sheet on iPhone, iPad & Mac, the Chunk Clipper in your browser, or forward any email to your private @in.chunkapp.com address. AI titles and files every capture.", BRAND['color_documents'], "NEW")}
    {_feature_card("🧠", "Memory 2.0", "Chunk now remembers you — your work, preferences, and goals — so every conversation starts smarter. Opt-in, encrypted, and fully editable.", BRAND['color_notes'], "NEW")}
    {_feature_card("⚡", "Smarter AI Models", "The latest GPT-5, Claude, and Gemini models — faster, more accurate, and more capable. Switch per conversation.", BRAND['color_reports'], "UPDATED")}
    {_gradient_banner(
        "Ready to Come Back?",
        "Your notes and collections are still here — just <strong style='color:#FF6A42'>$5.83/month</strong>",
        "All AI models, one research workspace"
    )}
    """

    html = _base_email_template(
        preheader="Automations, Share to Chunk, Memory 2.0 — Chunk has changed since you left.",
        hero_title="A Lot Has Changed",
        hero_subtitle="Here's what you've been missing.",
        body_content=body,
        cta_text="See What's New",
        cta_url=BRAND["web_url"],
        hero_dark=False,
        hero_label="WHAT'S NEW",
    )

    return (
        subject,
        html,
        f"Chunk has new features: Automations, Share to Chunk capture, Memory 2.0, and smarter models. Come see what's new: {BRAND['web_url']}",
    )


def get_monthly_recap_email(
    user_name: str = "there",
    searches: int = 0,
    documents: int = 0,
    images: int = 0,
    notes: int = 0,
    collections: int = 0,
) -> tuple[str, str, str]:
    """Generate monthly recap email — data-driven engagement."""
    subject = "📊 Your Chunk Month in Review"

    # Build the secondary stats row (notes + collections) if either is non-zero
    secondary_stats = ""
    if notes > 0 or collections > 0:
        secondary_stats = f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr>
            {_stat_block(str(notes), "Notes", BRAND['color_notes'])}
            <td style="width:8px" width="8"></td>
            {_stat_block(str(collections), "Collections", BRAND['color_urls'])}
            <td style="width:8px" width="8"></td>
            <td style="padding:16px;background-color:{BRAND['surface_elevated']};border:1px solid {BRAND['surface']};border-radius:10px;text-align:center" class="surface-card">
                <p style="margin:0;font-family:{FONT_SERIF};font-size:28px;font-weight:600;color:{BRAND['butter_deep']};letter-spacing:-0.02em" class="dm-butter">~{searches * 5}</p>
                <p style="margin:4px 0 0 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_faint']}" class="text-muted-dm">Min Saved</p>
            </td>
        </tr>
    </table>
    """
        time_saved_line = ""
    else:
        time_saved_line = f"""
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Based on average research time, you've saved roughly <strong>~{searches * 5} minutes</strong> this month. That's real hours back in your day.
    </p>
    """

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Here's what you accomplished with Chunk this month:
    </p>

    <!-- Stats Grid: Searches, Documents, Images -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:{('8px' if secondary_stats else '24px')}">
        <tr>
            {_stat_block(str(searches), "Searches", BRAND['primary'])}
            <td style="width:8px" width="8"></td>
            {_stat_block(str(documents), "Documents", BRAND['accent_blue'])}
            <td style="width:8px" width="8"></td>
            {_stat_block(str(images), "Images", BRAND['purple'])}
        </tr>
    </table>

    {secondary_stats}
    {time_saved_line}
    {_serif_statement("Keep building your knowledge.", "knowledge.")}
    """

    # Build preheader with all non-zero stats
    stat_parts = []
    if searches: stat_parts.append(f"{searches} searches")
    if documents: stat_parts.append(f"{documents} documents")
    if notes: stat_parts.append(f"{notes} notes")
    if collections: stat_parts.append(f"{collections} collections")
    if images: stat_parts.append(f"{images} images")
    preheader_stats = ", ".join(stat_parts) if stat_parts else "your activity"

    html = _base_email_template(
        preheader=f"Your Chunk month: {preheader_stats}.",
        hero_title="Your Month in Review",
        hero_subtitle="Here's what you accomplished with Chunk.",
        body_content=body,
        cta_text="Continue Researching",
        cta_url=BRAND["web_url"],
        footer_tip="Set up an Automation — Chunk re-runs your query on a schedule and emails you a cited digest of what changed.",
        hero_dark=True,
        hero_label="MONTHLY RECAP",
    )

    return (
        subject,
        html,
        f"Your Chunk month: {preheader_stats}. Keep exploring!",
    )


def get_renewal_reminder_email(
    user_name: str = "there", days_until_renewal: int = 7, amount: str = "$9.99"
) -> tuple[str, str, str]:
    """Generate renewal reminder email — transparent, grateful."""
    subject = f"📅 Your Subscription Renews in {days_until_renewal} Day{'s' if days_until_renewal > 1 else ''}"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Just a heads up — your Chunk Pro subscription will automatically renew in <strong>{days_until_renewal} day{'s' if days_until_renewal > 1 else ''}</strong>.
    </p>

    <!-- Renewal Amount Card -->
    {_dark_card(f"""
        <table width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr>
                <td>
                    <p style="margin:0 0 4px 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_muted_dark']}">Renewal Amount</p>
                    <p style="margin:0;font-family:{FONT_SERIF};font-size:28px;font-weight:600;color:{BRAND['text_inverse']}">{amount}</p>
                </td>
                <td align="right" style="vertical-align:middle">
                    <div style="width:10px;height:10px;border-radius:50%;background-color:{BRAND['signal_green']};display:inline-block"></div>
                    <span style="font-family:{FONT_MONO};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#A9C8A4;margin-left:6px">Active</span>
                </td>
            </tr>
        </table>
    """)}

    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        No action needed — your Pro access will continue uninterrupted. Thank you for being a subscriber.
    </p>
    <p style="margin:0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_muted']};line-height:1.6">
        Need to update your payment method or have questions? Just reply to this email.
    </p>
    """

    html = _base_email_template(
        preheader=f"Your Chunk Pro subscription ({amount}) renews in {days_until_renewal} days. No action needed.",
        hero_title="Renewal Reminder",
        hero_subtitle=f"Your Pro subscription renews in {days_until_renewal} day{'s' if days_until_renewal > 1 else ''}.",
        body_content=body,
        cta_text="Manage Subscription",
        cta_url=BRAND["web_url"],
        hero_dark=False,
    )

    return (
        subject,
        html,
        f"Your Chunk Pro subscription ({amount}) renews in {days_until_renewal} days. No action needed!",
    )


def get_day1_help_center_email(user_name: str = "there") -> tuple[str, str, str]:
    """
    Day 1 welcome email: Help Center announcement.
    Focus: reducing overwhelm, showing new users where to find help. Tone: supportive, empowering.
    """
    subject = "📖 Your guide to getting the most out of Chunk"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 16px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Chunk is a powerful workspace — AI chat, research reports, connected notes, collections, artifacts, and more. That's a lot to explore.
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        We built the <strong style="color:{BRAND['primary']}">Help Center</strong> so you always know exactly where to go next. Step-by-step guides, feature deep-dives, real workflows, and quick answers — all in one place.
    </p>

    {_serif_statement("Learn faster. Get unstuck.")}

    {_feature_card("🚀", "Getting Started", "New to Chunk? A 10-minute walkthrough covering your first question, first research report, first note, and first collection.", BRAND['color_notes'], "ONBOARDING")}
    {_feature_card("🔍", "Feature Guides", "Deep dives into AI Chat, Research Reports, Notes & Wiki-Links, Artifacts, Documents, and Collections — with tips you won't find anywhere else.", BRAND['color_documents'], "FEATURES")}
    {_feature_card("🗺️", "Workflows", "Step-by-step guides for real tasks: researching a topic end-to-end, organizing your notes, and building a knowledge base from scratch.", BRAND['color_urls'], "GUIDES")}
    {_feature_card("💡", "FAQ", "Quick answers on billing, platforms, AI models, privacy, exporting data, and more — so you can spend less time searching and more time learning.", BRAND['gold'], "ANSWERS")}

    <p style="margin:20px 0 4px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6;text-align:center" class="text-dark">
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
        hero_label="WELCOME · DAY 1",
        hero_serif_word="guide",
    )

    return (
        subject,
        html,
        f"We built the Help Center so you always know where to go next — getting started guides, feature deep-dives, workflows, and FAQ. https://www.chunkapp.com/help",
    )


def get_day3_artifacts_email(user_name: str = "there") -> tuple[str, str, str]:
    """
    Day 3 email: Artifacts feature announcement.
    Focus: turning any content into interactive learning materials. Tone: exciting, practical.
    """
    subject = "🧪 Turn any content into flashcards, quizzes, and summaries — instantly"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Turn any content into knowledge. Instantly.
    </p>

    {_serif_statement("Don't just consume. Understand.")}

    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        <strong style="color:{BRAND['primary']}">Artifacts</strong> transforms YouTube videos, PDFs, podcasts, audio files, and web articles into interactive study materials — flashcards, quizzes, summaries, and concept maps — in seconds.
    </p>

    {_protocol_step("01", "Drop in your content", "Paste a URL, upload a PDF, or drag in an audio file.")}
    {_protocol_step("02", "Choose your outputs", "Select from transcripts, summaries, flashcards, quizzes, or concept maps.")}
    {_protocol_step("03", "Learn, don't just read", "Interactive flashcards, quiz yourself, explore concept maps.")}

    {_feature_card("🎓", "Students", "Drop a 90-min recorded lecture — get flashcards and a quiz in 60 seconds. Perfect for spaced repetition and self-testing.", BRAND['primary'], "USE CASE")}
    {_feature_card("🔬", "Researchers", "Upload research PDFs — get concept maps showing how ideas connect, plus structured summaries.", BRAND['color_documents'], "USE CASE")}
    {_feature_card("💼", "Professionals", "Paste an industry podcast — get a 2-minute executive summary with key timestamps.", BRAND['color_urls'], "USE CASE")}

    <p style="margin:20px 0 0 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Artifacts is available now in Chunk Pro. Transform any content into interactive learning materials in seconds.
    </p>
    """

    html = _base_email_template(
        preheader="Turn lectures, YouTube videos, and PDFs into interactive study guides, flashcards, quizzes, and concept maps in seconds.",
        hero_title="Input Content. Extract Knowledge. Instantly.",
        hero_subtitle="Turn any content into flashcards, quizzes, summaries, and concept maps.",
        body_content=body,
        cta_text="Try Artifacts",
        cta_url="https://www.chunkapp.com/features/artifacts",
        footer_tip="Artifacts is a Pro feature. Upgrade to Chunk Pro to unlock unlimited transformations.",
        hero_dark=True,
        hero_label="WELCOME · DAY 3",
        hero_serif_word="Instantly.",
    )

    return (
        subject,
        html,
        f"Turn any content into knowledge — flashcards, quizzes, summaries, and concept maps from YouTube, PDFs, podcasts, and more. https://www.chunkapp.com/features/artifacts",
    )


def get_day7_researcher_stories_email(user_name: str = "there") -> tuple[str, str, str]:
    """
    Day 7 email: How researchers use Chunk.
    Focus: social proof with specific use cases. Tone: aspirational, community.
    """
    subject = "🎓 How Researchers Use Chunk"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        After a week with Chunk, we wanted to share how others are getting the most out of it.
    </p>

    {_quote_card(
        "I build a Collection for each paper I'm writing — my notes, cited PDFs, and relevant URLs all in one place. Then I ask Chunk to find gaps in my argument. It's like having a co-author who's read everything.",
        "PhD Student · Neuroscience",
        BRAND['color_documents']
    )}
    {_quote_card(
        "The knowledge graph changed how I think about my research. I wiki-link every concept, and suddenly I can see connections between ideas that I never would have noticed in a flat note list.",
        "Medical Researcher · Systematic Reviews",
        BRAND['color_notes']
    )}
    {_quote_card(
        "Deep Research mode is absurd. I asked it to analyze market trends for a pitch deck and got a 15-page report with 40+ sources in under 10 minutes. My analysts can't do that.",
        "Startup Founder · Series A",
        BRAND['color_reports']
    )}
    {_quote_card(
        "I use Claude for long-form writing, GPT-5 for data analysis, and Gemini for quick lookups. Switching models mid-research used to mean switching apps. Now it's a dropdown.",
        "Content Strategist · Tech Industry",
        BRAND['purple']
    )}

    {_serif_statement("What will you build with Chunk?", "build")}

    <p style="margin:0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        We'd love to hear your story — just reply to this email.
    </p>
    """

    html = _base_email_template(
        preheader="How researchers, founders, and knowledge workers are using Collections, the Knowledge Graph, and Deep Research to work smarter.",
        hero_title="How Researchers Use Chunk",
        hero_subtitle="Real stories from people doing real work.",
        body_content=body,
        cta_text="Continue Your Research",
        cta_url=BRAND["web_url"],
        hero_dark=True,
        hero_label="WELCOME · DAY 7",
    )

    return (
        subject,
        html,
        f"See how researchers, founders, and strategists use Chunk's Collections, Knowledge Graph, and Deep Research: {BRAND['web_url']}",
    )


def get_billing_issue_email(user_name: str = "there") -> tuple[str, str, str]:
    """Generate billing issue email — helpful, clear action required."""
    subject = "⚠️ Action Required: Update Your Payment Method"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        We tried to process your Chunk Pro payment, but it didn't go through. This usually happens when a card expires, gets replaced, or the bank blocks the charge.
    </p>

    <!-- Warning Card -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;background-color:#FBEFD4;border-radius:16px;border-left:6px solid {BRAND['gold']};overflow:hidden" class="warn-card">
        <tr>
            <td style="padding:20px 24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:16px;font-weight:700;color:{BRAND['butter_deep']}" class="warn-title">⏰ Please update within 3 days</p>
                <p style="margin:0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_primary']};line-height:1.5" class="text-dark">To avoid interruption to your Pro features — including Research in Collections, Deep Research, and multi-model AI.</p>
            </td>
        </tr>
    </table>

    {_protocol_step("01", "Open Settings", "In Chunk, go to Settings → Subscription.")}
    {_protocol_step("02", "Manage Subscription", "Tap 'Manage Subscription' to open the App Store.")}
    {_protocol_step("03", "Update Payment", "Update your payment method in the App Store settings.")}

    <p style="margin:16px 0 0 0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_muted']};line-height:1.6">
        Questions? Just reply to this email — we're here to help.
    </p>
    """

    html = _base_email_template(
        preheader="Your Chunk Pro payment didn't go through. Update your payment method to keep your research workspace active.",
        hero_title="Update Your Payment Method",
        hero_subtitle="There was an issue processing your payment.",
        body_content=body,
        cta_text="Update Payment",
        cta_url=BRAND["web_url"],
        hero_dark=False,
    )

    return (
        subject,
        html,
        f"We couldn't process your Chunk Pro payment. Please update your payment method to keep your research workspace active: {BRAND['web_url']}",
    )


def get_reengagement_14day_email(user_name: str = "there") -> tuple[str, str, str]:
    """Generate 14-day re-engagement email — feature showcase for inactive users."""
    subject = "Your AI research workspace is waiting 👋"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        It's been a couple weeks since you last opened Chunk. Here are features you might not have discovered yet:
    </p>

    {_feature_card("📚", "Research in Collections", "Gather documents, notes, URLs, and chats into one workspace — then ask AI questions across all of it. Like having a research team that's read everything.", BRAND['color_documents'], "TRY THIS")}
    {_feature_card("📝", "Connected Notes + Knowledge Graph", "Write wiki-linked notes ([[like this]]) and watch a visual knowledge graph reveal how your ideas connect. Spot patterns, find gaps, build deeper understanding.", BRAND['color_notes'], "TRY THIS")}
    {_feature_card("🔬", "Deep Research Mode", "Ask any complex question and get a comprehensive report with sources. Multi-source synthesis in minutes, not hours.", BRAND['color_reports'], "TRY THIS")}
    {_feature_card("📡", "Automations", "Set a query once and let Chunk re-run it on a schedule — you get a cited digest of what changed, without lifting a finger.", BRAND['color_urls'], "TRY THIS")}
    {_feature_card("📥", "Share to Chunk", "Share from any app on iPhone, iPad & Mac, clip pages in your browser, or forward emails to your private Chunk address — everything lands in your Inbox, titled and filed by AI.", BRAND['color_documents'], "TRY THIS")}

    {_serif_statement("Your workspace is ready and waiting.", "ready and waiting.")}
    """

    html = _base_email_template(
        preheader="Your Chunk research workspace is waiting. Collections, Connected Notes, Deep Research — features you haven't tried yet.",
        hero_title="Your Research Workspace is Waiting",
        hero_subtitle="Features you might not have discovered yet.",
        body_content=body,
        cta_text="Open Chunk",
        cta_url=BRAND["login_url"],
        footer_tip="Try Research in Collections — create a Collection, add a few sources, and ask Chunk to synthesize across everything.",
        hero_dark=True,
    )

    return (
        subject,
        html,
        f"Your Chunk research workspace is waiting. Collections, Connected Notes, Deep Research, and more: {BRAND['login_url']}",
    )


def get_memory_2_announcement_email(
    user_name: str = "there",
) -> tuple[str, str, str]:
    """Generate Memory 2.0 announcement broadcast email — rich custom layout."""
    subject = "🧠 Introducing Memory 2.0 — Chunk now remembers you"

    # Screenshot image — hosted on cerebral-analytics static assets
    screenshot_url = "https://cerebral-analytics-eff2e86d22c4.herokuapp.com/static/email-assets/memory-insights-screenshot.png"

    body = f"""
    <!-- Serif statement -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px">
        <tr>
            <td align="center" style="padding:8px 0">
                <p style="margin:0;font-family:{FONT_SERIF};font-weight:600;font-size:26px;color:{BRAND['text_primary']};line-height:1.15;text-align:center" class="text-dark">
                    The AI that actually <span style="font-style:italic;color:{BRAND['primary']}">knows</span> you.
                </p>
            </td>
        </tr>
    </table>

    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.7" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.7" class="text-dark">
        Most AI tools forget you the moment the conversation ends. Starting today, <strong>Chunk doesn't.</strong>
    </p>
    <p style="margin:0 0 28px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.7" class="text-dark">
        With <strong>Memory 2.0</strong>, Chunk quietly learns who you are &mdash; your work, your preferences, your goals &mdash; and uses that understanding to give you <em>better answers, every time.</em>
    </p>

    <!-- How It Works — 3 Steps -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:8px">
        <tr>
            <td>
                <p style="margin:0 0 16px 0;font-family:{FONT_SANS};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{BRAND['sage_deep']};font-weight:700" class="dm-sage">HOW IT WORKS</p>
            </td>
        </tr>
    </table>

    {_protocol_step("01", "You talk. Chunk listens.", 'As you chat, Chunk automatically picks up the things that matter — your name, your job, the tools you use, your preferences. No setup needed.')}
    {_protocol_step("02", "Chunk builds a picture of you.", 'Behind the scenes, two layers of understanding form: quick facts (name, role, stack) and deeper context (projects, decisions, how you think).')}
    {_protocol_step("03", "Every conversation starts smarter.", 'When you open a new chat, Chunk already has context. No re-explaining. No generic answers. Just an AI that gets you from message one.')}

    <!-- Screenshot -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0 32px 0">
        <tr>
            <td align="center">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(93,64,28,0.14);border:1px solid {BRAND['surface']}">
                    <tr>
                        <td>
                            <img
                                src="{screenshot_url}"
                                alt="Memory Insights tab in Chunk — showing patterns, decisions, and project context"
                                width="520"
                                style="display:block;border:none;width:520px;max-width:100%;height:auto;border-radius:16px"
                            >
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr>
            <td align="center" style="padding-top:10px">
                <p style="margin:0;font-family:{FONT_MONO};font-size:11px;letter-spacing:0.08em;color:{BRAND['text_muted']}">THE NEW INSIGHTS TAB — PATTERNS, DECISIONS, AND CONTEXT</p>
            </td>
        </tr>
    </table>

    <!-- Two Layers Section -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:8px">
        <tr>
            <td>
                <p style="margin:0 0 16px 0;font-family:{FONT_SANS};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{BRAND['butter_deep']};font-weight:700" class="dm-butter">TWO LAYERS OF UNDERSTANDING</p>
            </td>
        </tr>
    </table>

    {_feature_card("⚡", "Layer 1 — Facts", "Quick, atomic facts about you: your name, your job, your location, your tech stack. Always available, always accurate.", BRAND['accent_blue'], "ALL USERS")}
    {_feature_card("🧠", "Layer 2 — Journal", "Rich contextual insights from full conversations. Your working style, evolving preferences, ongoing projects, and the decisions you've made and why.", BRAND['purple'], "CHUNK PRO")}

    <!-- Privacy Card -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 28px 0;background-color:{BRAND['bg_dark']};border-radius:16px;border:1px solid {BRAND['night_line']};overflow:hidden" class="dark-card">
        <tr>
            <td style="padding:24px">
                <table width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="width:36px;vertical-align:top;padding-right:14px;font-size:22px" width="36">🔒</td>
                        <td style="vertical-align:top">
                            <p style="margin:0 0 6px 0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_inverse']};font-size:16px;letter-spacing:-0.01em">Privacy first. Always.</p>
                            <p style="margin:0;font-family:{FONT_SANS};color:{BRAND['text_muted_dark']};font-size:14px;line-height:1.6">
                                Encrypted at rest with per-user keys. Passwords and sensitive PII are automatically blocked.
                                View, edit, or delete any memory at any time. Full control is yours.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    <!-- Availability -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px;background-color:{BRAND['surface_elevated']};border:1px solid {BRAND['surface']};border-radius:16px;overflow:hidden" class="surface-card">
        <tr>
            <td style="padding:20px 24px;text-align:center">
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{BRAND['sage_deep']};font-weight:700" class="dm-sage">AVAILABILITY</p>
                <p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-size:16px;font-weight:700;color:{BRAND['text_primary']}" class="text-dark">
                    ✅ <span style="color:{BRAND['sage_deep']}" class="dm-sage">Live now</span> on the web
                </p>
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_muted']}" class="text-muted-dm">
                    Coming soon to Mac, iPhone, and iPad
                </p>
                <p style="margin:0;font-family:{FONT_SANS};font-size:13px;color:{BRAND['text_muted']};line-height:1.5" class="text-muted-dm">
                    Layer 1 (Facts) is available to all users.<br>
                    Layer 2 (Journal) is exclusive to <strong style="color:{BRAND['primary']}">Chunk Pro</strong> subscribers.
                </p>
            </td>
        </tr>
    </table>

    <!-- Enable CTA -->
    <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.7" class="text-dark">
        To get started, head to <strong>Settings → Memory</strong> and flip the switch. Then just use Chunk normally — Memory does the rest.
    </p>
    """

    html = _base_email_template(
        preheader="Chunk now remembers who you are — your work, your preferences, your goals. Every conversation starts smarter.",
        hero_title="Memory 2.0",
        hero_subtitle="Every conversation is smarter than the last.",
        body_content=body,
        cta_text="Try Memory Now",
        cta_url="https://www.chunkapp.com/login",
        footer_tip="Memory is opt-in. Head to Settings → Memory to turn it on and see what Chunk knows about you.",
        hero_dark=True,
        hero_label="NOW AVAILABLE",
        hero_serif_word="Memory",
    )

    # Replace the custom unsubscribe placeholder with Resend's native broadcast
    # unsubscribe URL. Broadcasts don't go through send_email() so our custom
    # replacement never fires — Resend handles unsubscribe natively for broadcasts.
    resend_unsubscribe_link = (
        f'<a href="{{{{{{RESEND_UNSUBSCRIBE_URL}}}}}}" '
        f'style="color:{BRAND["text_muted_dark"]};text-decoration:none">Unsubscribe</a>'
        f'<span style="color:rgba(246,239,228,0.45)"> · </span>'
    )
    html = html.replace("{UNSUBSCRIBE_LINK_PLACEHOLDER}", resend_unsubscribe_link)

    text = (
        "Introducing Memory 2.0 — Chunk now remembers you.\n\n"
        "Most AI tools forget you the moment the conversation ends. Chunk doesn't.\n\n"
        "With Memory 2.0, Chunk quietly learns who you are — your work, your preferences, "
        "your goals — and uses that understanding to give you better answers, every time.\n\n"
        "HOW IT WORKS:\n"
        "1. You talk. Chunk listens. — As you chat, Chunk picks up facts automatically.\n"
        "2. Chunk builds a picture of you. — Two layers: quick facts + deep context.\n"
        "3. Every conversation starts smarter. — No re-explaining yourself.\n\n"
        "PRIVACY: Encrypted at rest. Sensitive PII blocked. Full control to view, edit, delete.\n\n"
        "Layer 1 (Facts) is available to all users. Layer 2 (Journal) is exclusive to Chunk Pro.\n\n"
        "Available now on the web. Coming soon to Mac, iPhone, and iPad.\n\n"
        "To get started, head to Settings → Memory and flip the switch.\n\n"
        "Try it now: https://www.chunkapp.com/login"
    )

    return subject, html, text


def get_feature_announcement_email(
    user_name: str = "there",
    feature_name: str = "",
    feature_description: str = "",
    feature_emoji: str = "🆕",
) -> tuple[str, str, str]:
    """Generate feature announcement email — new feature spotlight."""
    subject = f"{feature_emoji} New in Chunk: {feature_name}"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        We just shipped something new:
    </p>
    {_feature_card(feature_emoji, feature_name, feature_description, BRAND['primary'], "JUST SHIPPED")}
    <p style="margin:20px 0 0 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Update the app and give it a try — we built this one for you.
    </p>
    """

    html = _base_email_template(
        preheader=f"New in Chunk: {feature_name} — {feature_description}",
        hero_title=f"New: {feature_name}",
        hero_subtitle="A new feature just shipped.",
        body_content=body,
        cta_text="Try It Now",
        cta_url=BRAND["login_url"],
        hero_dark=True,
        hero_label="NEW FEATURE",
    )

    return (
        subject,
        html,
        f"New in Chunk: {feature_name} — {feature_description}. Try it now: {BRAND['login_url']}",
    )


def get_signup_no_trial_nudge_email(user_name: str = "there") -> tuple[str, str, str]:
    """Generate nudge email for users who signed up but never started a trial."""
    subject = "You left something on the table ✨"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        You signed up for Chunk but haven't started your <strong>free 3-day Pro trial</strong> yet. That means you're missing out on the full research workspace:
    </p>

    {_protocol_step("01", "Research in Collections", "Gather all your sources in one workspace and chat with AI that's read everything. Documents, notes, URLs — cross-referenced and searchable.")}
    {_protocol_step("02", "Connected Notes + Knowledge Graph", "Wiki-linked notes that form a living visual map of your ideas. Cluster detection, orphan surfacing, backlinks — all automatic.")}
    {_protocol_step("03", "Deep Research + Every AI Model", "Comprehensive research reports with citations, plus GPT-5, Claude, and Gemini — all in one app.")}
    {_protocol_step("04", "Automations", "Standing agents that re-run your research on a schedule and email you a cited digest of what changed.")}

    <!-- Trial CTA Card -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0 0;background-color:#E2EDDF;border-radius:16px;border-left:6px solid {BRAND['signal_green']};overflow:hidden" class="green-card">
        <tr>
            <td style="padding:24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:18px;font-weight:700;color:{BRAND['sage_deep']}" class="green-card-title dm-sage">🎁 Your free trial is waiting</p>
                <p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']}" class="text-dark"><strong>3 days of full Pro access</strong> — every AI model and feature, unlocked.</p>
                <p style="margin:0;font-family:{FONT_MONO};font-size:12px;color:{BRAND['text_faint']}" class="text-muted-dm">Cancel anytime before it ends and you won't be charged.</p>
            </td>
        </tr>
    </table>
    """

    html = _base_email_template(
        preheader="Your 3-day Pro trial is waiting. Research in Collections, Connected Notes, Deep Research — cancel anytime before it ends.",
        hero_title="You Left Something on the Table",
        hero_subtitle="Your free Pro trial is waiting for you.",
        body_content=body,
        cta_text="Start Free Trial",
        cta_url=BRAND["login_url"],
        footer_tip="3 days of full access to every AI model and feature. Cancel anytime before the trial ends and you won't be charged.",
        hero_dark=False,
        hero_label="DON'T MISS OUT",
    )

    return (
        subject,
        html,
        f"You signed up for Chunk but haven't started your Pro trial yet. 3 days of full access — cancel anytime before it ends and you won't be charged: {BRAND['login_url']}",
    )


# ============================================================
# Send Email Function
# ============================================================


async def send_email_async(to_email: str, subject: str, html: str, text: str, email_type: str = None, user_id: str = None) -> dict:
    """Send email via Resend API (async)."""
    import hashlib
    import hmac

    # Generate unsubscribe token and URL
    secret = os.getenv("EMAIL_UNSUBSCRIBE_SECRET", "chunk-unsubscribe-default-secret")
    unsubscribe_base = os.getenv("EMAIL_UNSUBSCRIBE_BASE_URL", "https://cerebral-12658c15cdb1.herokuapp.com")
    unsubscribe_token = hmac.new(secret.encode(), to_email.encode(), hashlib.sha256).hexdigest()
    unsubscribe_url = f"{unsubscribe_base}/email/unsubscribe?email={to_email}&token={unsubscribe_token}"

    # Inject unsubscribe link into HTML body (cream-soft text — footer is night bg)
    unsubscribe_link_html = f'<a href="{unsubscribe_url}" style="color:{BRAND["text_muted_dark"]};text-decoration:none">Unsubscribe</a><span style="color:rgba(246,239,228,0.45)"> · </span>'
    html = html.replace("{UNSUBSCRIBE_LINK_PLACEHOLDER}", unsubscribe_link_html)

    # Build payload
    payload = {
        "from": FROM_EMAIL,
        "to": [to_email],
        "subject": subject,
        "html": html,
        "text": text,
        "headers": {
            "List-Unsubscribe": f"<{unsubscribe_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
        }
    }

    # Add tags if provided
    if email_type or user_id:
        tags = []
        if email_type:
            tags.append({"name": "email_type", "value": email_type})
        if user_id:
            tags.append({"name": "user_id", "value": user_id})
        payload["tags"] = tags

    async with httpx.AsyncClient() as client:
        response = await client.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

        if response.status_code == 200:
            logging.info(f"Email sent successfully to {to_email}: {subject}")
            result = response.json()
            return {"id": result.get("id"), **result}
        else:
            logging.error(
                f"Failed to send email to {to_email}: {response.status_code} - {response.text}"
            )
            raise Exception(f"Email send failed: {response.status_code}")


def send_email(to_email: str, subject: str, html: str, text: str, email_type: str = None, user_id: str = None) -> dict:
    """Send email via Resend API (sync)."""
    import hashlib
    import hmac

    # Generate unsubscribe token and URL
    secret = os.getenv("EMAIL_UNSUBSCRIBE_SECRET", "chunk-unsubscribe-default-secret")
    unsubscribe_base = os.getenv("EMAIL_UNSUBSCRIBE_BASE_URL", "https://cerebral-12658c15cdb1.herokuapp.com")
    unsubscribe_token = hmac.new(secret.encode(), to_email.encode(), hashlib.sha256).hexdigest()
    unsubscribe_url = f"{unsubscribe_base}/email/unsubscribe?email={to_email}&token={unsubscribe_token}"

    # Inject unsubscribe link into HTML body (cream-soft text — footer is night bg)
    unsubscribe_link_html = f'<a href="{unsubscribe_url}" style="color:{BRAND["text_muted_dark"]};text-decoration:none">Unsubscribe</a><span style="color:rgba(246,239,228,0.45)"> · </span>'
    html = html.replace("{UNSUBSCRIBE_LINK_PLACEHOLDER}", unsubscribe_link_html)

    # Build payload
    payload = {
        "from": FROM_EMAIL,
        "to": [to_email],
        "subject": subject,
        "html": html,
        "text": text,
        "headers": {
            "List-Unsubscribe": f"<{unsubscribe_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
        }
    }

    # Add tags if provided
    if email_type or user_id:
        tags = []
        if email_type:
            tags.append({"name": "email_type", "value": email_type})
        if user_id:
            tags.append({"name": "user_id", "value": user_id})
        payload["tags"] = tags

    response = httpx.post(
        RESEND_API_URL,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30.0,
    )

    if response.status_code == 200:
        logging.info(f"Email sent successfully to {to_email}: {subject}")
        result = response.json()
        return {"id": result.get("id"), **result}
    else:
        logging.error(
            f"Failed to send email to {to_email}: {response.status_code} - {response.text}"
        )
        raise Exception(f"Email send failed: {response.status_code}")


# ============================================================
# Convenience Functions
# ============================================================


def send_welcome(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send instant welcome email."""
    subject, html, text = get_welcome_email(user_name)
    return send_email(to_email, subject, html, text, email_type="welcome", user_id=user_id)


def send_trial_started(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send trial started email."""
    subject, html, text = get_trial_started_email(user_name)
    return send_email(to_email, subject, html, text, email_type="trial_started", user_id=user_id)


def send_trial_ending(
    to_email: str, user_name: str = "there", hours_remaining: int = 12, user_id: str = None
) -> dict:
    """Send trial ending email."""
    subject, html, text = get_trial_ending_email(user_name, hours_remaining)
    return send_email(to_email, subject, html, text, email_type="trial_ending", user_id=user_id)


def send_subscription_expired(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send subscription expired email."""
    subject, html, text = get_subscription_expired_email(user_name)
    return send_email(to_email, subject, html, text, email_type="subscription_expired", user_id=user_id)


def send_winback_7day(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send 7-day winback email."""
    subject, html, text = get_winback_7day_email(user_name)
    return send_email(to_email, subject, html, text, email_type="winback_7day", user_id=user_id)


def send_winback_30day(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send 30-day winback email."""
    subject, html, text = get_winback_30day_email(user_name)
    return send_email(to_email, subject, html, text, email_type="winback_30day", user_id=user_id)


def send_monthly_recap(
    to_email: str,
    user_name: str = "there",
    searches: int = 0,
    documents: int = 0,
    images: int = 0,
    user_id: str = None,
    notes: int = 0,
    collections: int = 0,
) -> dict:
    """Send monthly recap email."""
    subject, html, text = get_monthly_recap_email(
        user_name, searches, documents, images, notes, collections,
    )
    return send_email(to_email, subject, html, text, email_type="monthly_recap", user_id=user_id)


def send_renewal_reminder(
    to_email: str,
    user_name: str = "there",
    days_until_renewal: int = 7,
    amount: str = "$9.99",
    user_id: str = None,
) -> dict:
    """Send renewal reminder email."""
    subject, html, text = get_renewal_reminder_email(
        user_name, days_until_renewal, amount
    )
    return send_email(to_email, subject, html, text, email_type="renewal_reminder", user_id=user_id)


def send_day1_help_center(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send Day 1 welcome sequence email: Help Center."""
    subject, html, text = get_day1_help_center_email(user_name)
    return send_email(to_email, subject, html, text, email_type="day1_help_center", user_id=user_id)


def send_day3_artifacts(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send Day 3 Artifacts feature email."""
    subject, html, text = get_day3_artifacts_email(user_name)
    return send_email(to_email, subject, html, text, email_type="day3_artifacts", user_id=user_id)


def send_day7_researcher_stories(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send Day 7 researcher stories email."""
    subject, html, text = get_day7_researcher_stories_email(user_name)
    return send_email(to_email, subject, html, text, email_type="day7_researcher_stories", user_id=user_id)


def send_billing_issue(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send billing issue email."""
    subject, html, text = get_billing_issue_email(user_name)
    return send_email(to_email, subject, html, text, email_type="billing_issue", user_id=user_id)


def send_reengagement_14day(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send 14-day re-engagement email."""
    subject, html, text = get_reengagement_14day_email(user_name)
    return send_email(to_email, subject, html, text, email_type="reengagement_14day", user_id=user_id)


def send_feature_announcement(
    to_email: str,
    user_name: str = "there",
    feature_name: str = "",
    feature_description: str = "",
    feature_emoji: str = "🆕",
    user_id: str = None,
) -> dict:
    """Send feature announcement email."""
    subject, html, text = get_feature_announcement_email(
        user_name, feature_name, feature_description, feature_emoji
    )
    return send_email(to_email, subject, html, text, email_type="feature_announcement", user_id=user_id)


def send_signup_no_trial_nudge(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send signup no-trial nudge email."""
    subject, html, text = get_signup_no_trial_nudge_email(user_name)
    return send_email(to_email, subject, html, text, email_type="signup_no_trial_nudge", user_id=user_id)


def send_memory_2_announcement(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send Memory 2.0 announcement broadcast email."""
    subject, html, text = get_memory_2_announcement_email(user_name)
    return send_email(to_email, subject, html, text, email_type="memory_2_announcement", user_id=user_id)
