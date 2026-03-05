"""
Email Service for Chunk AI
Uses Resend API to send transactional and marketing emails.

Design System: "Brutalist Signal" — adapted from Chunk marketing pages.
Typography: Space Grotesk (headings/body), DM Serif Display (drama/serif), Space Mono (data/mono)
Colors: Primary #E84D2B, BG Light #EAEAEA, BG Dark #1E1E1E, Text #161616, Accent Blue #7ABAE1, Signal Green #34D399
Content-type coding: Notes #E84D2B, Documents #7ABAE1, URLs #34D399, Reports #C4A74E, Conversations #9B7EBD
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

# Brand colors and assets — "Brutalist Signal" Design System
BRAND = {
    # Core palette
    "primary": "#E84D2B",
    "primary_light": "#FF6B4A",
    "bg_dark": "#1E1E1E",
    "bg_light": "#EAEAEA",
    "surface": "#D9D9D9",
    "surface_dark": "#2A2A2A",
    "surface_elevated": "#F5F3EE",
    "text_primary": "#161616",
    "text_inverse": "#D9D9D9",
    "text_muted": "#888888",
    # Accent colors
    "accent_blue": "#7ABAE1",
    "accent_blue_dark": "#5AA3D0",
    "signal_green": "#34D399",
    "gold": "#C4A74E",
    "purple": "#9B7EBD",
    # Content-type colors
    "color_notes": "#E84D2B",
    "color_documents": "#7ABAE1",
    "color_urls": "#34D399",
    "color_reports": "#C4A74E",
    "color_conversations": "#9B7EBD",
    # Gradient
    "gradient": "linear-gradient(90deg, #E84D2B 0%, #7ABAE1 100%)",
    # Assets — logos
    "logo_dark_url": "https://chunkapp.com/chunk-logo-dot.png",      # Dark text logo — for light backgrounds
    "logo_light_url": "https://chunkapp.com/chunk-logo-white.png",    # White text logo — for dark backgrounds
    "logo_url": "https://chunkapp.com/chunk_gradient_logo.png",       # Legacy fallback
    "app_store_url": "https://apps.apple.com/us/app/chunk-ai-research-assistant/id6472682763",
    "privacy_url": "https://www.chunkapp.com/privacy",
    "terms_url": "https://www.chunkapp.com/tos",
    "web_url": "https://chunkapp.com",
    "notes_url": "https://chunkapp.com/notes-feature",
    "collections_url": "https://chunkapp.com/collections-feature",
    "guide_url": "https://chunkapp.com/guide",
}

# Google Fonts URL for email
GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&family=DM+Serif+Display:ital@1&family=Space+Mono:wght@400;700&display=swap"

# Font stacks
FONT_SANS = "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
FONT_SERIF = "'DM Serif Display', Georgia, 'Times New Roman', serif"
FONT_MONO = "'Space Mono', 'SF Mono', 'Fira Code', Consolas, monospace"


# ============================================================
# Template Building Blocks
# ============================================================


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
    Generate base email HTML template using the Brutalist Signal design system.

    hero_dark: If True, hero section uses dark bg (#1E1E1E). If False, light bg (#EAEAEA).
    hero_label: Optional monospace label above the title (e.g., "WELCOME SEQUENCE · DAY 1").
    hero_serif_word: If provided, this word in the hero_title is wrapped in serif italic styling.
    """
    hero_bg = BRAND["bg_dark"] if hero_dark else BRAND["bg_light"]
    hero_text = BRAND["text_inverse"] if hero_dark else BRAND["text_primary"]
    hero_sub_text = f"{hero_text}CC" if hero_dark else f"{hero_text}99"  # with alpha
    hero_logo = BRAND["logo_light_url"] if hero_dark else BRAND["logo_dark_url"]

    # Process hero_serif_word if provided
    title_html = hero_title
    if hero_serif_word and hero_serif_word in hero_title:
        title_html = hero_title.replace(
            hero_serif_word,
            f'<span style="font-family:{FONT_SERIF};font-style:italic;color:{BRAND["primary"]}">{hero_serif_word}</span>'
        )

    label_html = ""
    if hero_label:
        label_html = f"""
        <tr>
            <td align="center" style="padding:0 40px 16px 40px">
                <p style="margin:0;font-family:{FONT_MONO};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:{BRAND['primary']};font-weight:700">{hero_label}</p>
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
                        <td style="padding:16px 48px;background-color:{BRAND['primary']};border-radius:100px;mso-padding-alt:0" class="cta-btn">
                            <a href="{cta_url}" style="color:#FFFFFF;font-family:{FONT_SANS};font-weight:700;text-decoration:none;font-size:16px;display:inline-block;line-height:24px" target="_blank">{cta_text}</a>
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
                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:{BRAND['surface_elevated']};border-top:1px solid {BRAND['surface']}" class="surface-card">
                    <tr>
                        <td style="padding:24px 40px">
                            <table width="100%" border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="width:4px;background-color:{BRAND['primary']};border-radius:2px" width="4"></td>
                                    <td style="padding-left:16px">
                                        <p style="margin:0 0 4px 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_muted']};font-weight:700" class="text-muted-dm">Quick Tip</p>
                                        <p style="margin:0;font-family:{FONT_SANS};color:{BRAND['text_primary']};font-size:14px;line-height:1.6;opacity:0.8" class="text-dark">{footer_tip}</p>
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

        /* ---- Dark Mode ---- */
        @media (prefers-color-scheme: dark) {{
            /* Outer wrapper */
            .email-wrapper {{ background-color: #111111 !important; }}
            /* Main card */
            .email-card {{ background-color: #1A1A1A !important; }}
            /* Body content area */
            .email-body {{ background-color: #1A1A1A !important; }}
            /* Light hero variant */
            .hero-light {{ background-color: #1A1A1A !important; }}
            /* Elevated surface cards (feature cards, stat blocks, quote cards, tip section) */
            .surface-card {{ background-color: #2A2A2A !important; }}
            /* Dark text → light text */
            .text-dark {{ color: #E8E4DD !important; }}
            /* Muted text stays readable */
            .text-muted-dm {{ color: #999999 !important; }}
            /* Platform badge area */
            .platform-badge {{ background-color: #1A1A1A !important; }}
            /* Ensure dark cards stay dark (prevent double-inversion) */
            .dark-card {{ background-color: {BRAND['bg_dark']} !important; }}
            /* CTA stays vibrant */
            .cta-btn {{ background-color: {BRAND['primary']} !important; }}
            /* Gradient banner stays as-is */
            .gradient-banner {{ background: {BRAND['gradient']} !important; }}
            /* Footer stays dark */
            .email-footer {{ background-color: {BRAND['bg_dark']} !important; }}
            /* Green CTA cards */
            .green-card {{ background-color: #1B3A2A !important; }}
            .green-card-title {{ color: #4ADE80 !important; }}
        }}
    </style>
</head>
<body style="margin:0;padding:0;background-color:{BRAND['bg_light']};font-family:{FONT_SANS}" class="email-wrapper">
    <!-- Preheader -->
    <div class="preheader" style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">{preheader}</div>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:{BRAND['bg_light']}" class="email-wrapper">
        <tr>
            <td align="center" style="padding:40px 20px">
                <table width="600" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)" class="email-card">

                    <!-- Gradient Bar -->
                    <tr>
                        <td style="height:8px;background:{BRAND['gradient']};font-size:0;line-height:0">&nbsp;</td>
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
                                        <h1 style="margin:0;font-family:{FONT_SANS};font-size:32px;font-weight:700;color:{hero_text};letter-spacing:-0.02em;line-height:1.2" class="{'text-dark' if not hero_dark else ''}">{title_html}</h1>
                                    </td>
                                </tr>
                                <!-- Subtitle -->
                                <tr>
                                    <td align="center" style="padding:0">
                                        <p style="margin:0;font-family:{FONT_SANS};font-size:16px;color:{hero_sub_text if hero_dark else BRAND['text_muted']};line-height:1.6" class="{'text-muted-dm' if not hero_dark else ''}">{hero_subtitle}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding:32px 40px 8px 40px;background-color:#FFFFFF" class="email-body">
                            {body_content}
                        </td>
                    </tr>

                    {cta_section}

                    <!-- Platform Badge -->
                    <tr>
                        <td align="center" style="padding:16px 40px 32px 40px;background-color:#FFFFFF" class="platform-badge">
                            <p style="margin:0;font-family:{FONT_MONO};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_muted']}">
                                iOS · macOS · visionOS · Web
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
                                        <p style="margin:0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_inverse']};opacity:0.5">Questions? Just reply — we read everything.</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding-bottom:16px">
                                        <p style="margin:0;font-family:{FONT_MONO};font-size:11px;color:{BRAND['text_inverse']};opacity:0.3;letter-spacing:0.05em">&copy; 2026 Chunk AI</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center">
                                        <p style="margin:0;font-family:{FONT_SANS};font-size:13px">
                                            {{UNSUBSCRIBE_LINK_PLACEHOLDER}}
                                            <a href="{BRAND['privacy_url']}" style="color:{BRAND['primary']};text-decoration:none">Privacy</a>
                                            <span style="color:{BRAND['text_inverse']};opacity:0.3"> · </span>
                                            <a href="{BRAND['terms_url']}" style="color:{BRAND['primary']};text-decoration:none">Terms</a>
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
    Uses a left color strip instead of gradient icon background — cleaner, more brutalist.
    """
    label_html = ""
    if mono_label:
        label_html = f'<p style="margin:0 0 4px 0;font-family:{FONT_MONO};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:{accent_color};font-weight:700">{mono_label}</p>'

    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:12px;background-color:{BRAND['surface_elevated']};border-radius:16px;overflow:hidden" class="surface-card">
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
    """A dark-background card block — for emphasis, like the Protocol section dark cards."""
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:16px;background-color:{BRAND['bg_dark']};border-radius:16px;border:1px solid {BRAND['surface_dark']};overflow:hidden" class="dark-card">
        <tr>
            <td style="padding:24px">
                {content}
            </td>
        </tr>
    </table>
    """


def _protocol_step(number: str, title: str, description: str) -> str:
    """Protocol-style numbered step — inspired by the Workflow Protocol section."""
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:16px">
        <tr>
            <td style="width:48px;vertical-align:top;padding-right:12px" width="48">
                <p style="margin:0;font-family:{FONT_MONO};font-size:20px;font-weight:700;color:{BRAND['primary']};line-height:1">{number}</p>
            </td>
            <td style="vertical-align:top">
                <p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-weight:700;color:{BRAND['text_primary']};font-size:18px;letter-spacing:-0.02em" class="text-dark">{title}</p>
                <p style="margin:0;font-family:{FONT_SANS};color:{BRAND['text_muted']};font-size:14px;line-height:1.6" class="text-muted-dm">{description}</p>
            </td>
        </tr>
    </table>
    """


def _stat_block(value: str, label: str, color: str) -> str:
    """A stat display block — number + label, color-accented."""
    return f"""
    <td style="padding:16px;background-color:{BRAND['surface_elevated']};border-radius:12px;text-align:center" class="surface-card">
        <p style="margin:0;font-family:{FONT_MONO};font-size:28px;font-weight:700;color:{color};letter-spacing:-0.02em">{value}</p>
        <p style="margin:4px 0 0 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_muted']}" class="text-muted-dm">{label}</p>
    </td>
    """


def _quote_card(quote: str, attribution: str, accent_color: str) -> str:
    """A testimonial/quote card with left accent strip."""
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:12px;background-color:{BRAND['surface_elevated']};border-radius:16px;overflow:hidden" class="surface-card">
        <tr>
            <td style="width:4px;background-color:{accent_color}" width="4"></td>
            <td style="padding:20px 24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:15px;color:{BRAND['text_primary']};font-style:italic;line-height:1.6" class="text-dark">"{quote}"</p>
                <p style="margin:0;font-family:{FONT_MONO};font-size:11px;letter-spacing:0.08em;color:{accent_color};font-weight:700">{attribution}</p>
            </td>
        </tr>
    </table>
    """


def _serif_statement(text: str, highlight: Optional[str] = None) -> str:
    """A big serif italic statement — like the Philosophy section."""
    display_text = text
    if highlight and highlight in text:
        display_text = text.replace(
            highlight,
            f'<span style="color:{BRAND["primary"]}">{highlight}</span>'
        )
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px">
        <tr>
            <td align="center" style="padding:8px 0">
                <p style="margin:0;font-family:{FONT_SERIF};font-style:italic;font-size:28px;color:{BRAND['text_primary']};line-height:1.3;text-align:center" class="text-dark">{display_text}</p>
            </td>
        </tr>
    </table>
    """


def _gradient_banner(headline: str, subline: str, detail: Optional[str] = None) -> str:
    """A full-width gradient banner — primary to accent blue."""
    detail_html = ""
    if detail:
        detail_html = f'<p style="margin:8px 0 0 0;font-family:{FONT_MONO};font-size:12px;color:rgba(255,255,255,0.6)">{detail}</p>'
    return f"""
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;background:{BRAND['gradient']};border-radius:16px;overflow:hidden" class="gradient-banner">
        <tr>
            <td align="center" style="padding:32px 24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.02em">{headline}</p>
                <p style="margin:0;font-family:{FONT_SANS};font-size:15px;color:rgba(255,255,255,0.9)">{subline}</p>
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
            <p style="margin:0;font-family:{FONT_MONO};font-size:9px;letter-spacing:0.08em;color:{BRAND['text_muted']}">{emoji} {label}</p>
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
    {_feature_card("🧠", "Every AI Model", "GPT-5, Claude, Gemini, Llama — switch models per conversation. The right tool for every task, one subscription.", BRAND['purple'], "MULTI-MODEL")}
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
        <span style="color:{BRAND['color_notes']}">✕</span>&nbsp; AI-powered writing tools in Notes<br>
        <span style="color:{BRAND['purple']}">✕</span>&nbsp; GPT-5, Claude, Gemini model access<br>
        <span style="color:{BRAND['color_urls']}">✕</span>&nbsp; Knowledge graph visualization
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
        "GPT-5, Claude, Gemini & more — just <strong>$5.83/month</strong> on the yearly plan.",
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
        hero_serif_word=title if hours_remaining <= 24 else None,
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
    {_gradient_banner(
        "Come Back to Chunk",
        "All AI models, one research workspace — just <strong>$5.83/month</strong>",
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
    {_feature_card("🧠", "Research in Collections", "Run AI research directly inside a Collection. Chunk reads all your documents, notes, URLs, and past conversations — then synthesizes answers with full context.", BRAND['color_documents'], "NEW")}
    {_feature_card("🔗", "Knowledge Graph", "Your notes now form a living, visual map. Wiki-links connect ideas, clusters emerge automatically, and orphan notes get surfaced for you to connect.", BRAND['color_notes'], "NEW")}
    {_feature_card("⚡", "Smarter AI Models", "The latest GPT-5, Claude, and Gemini models — faster, more accurate, and more capable. Switch per conversation.", BRAND['purple'], "UPDATED")}
    {_feature_card("🧪", "Deeper Research Reports", "Research reports are now more comprehensive with better source citations, cross-referencing, and multi-perspective analysis.", BRAND['color_reports'], "IMPROVED")}
    {_gradient_banner(
        "Ready to Come Back?",
        "Your notes and collections are still here — just <strong>$5.83/month</strong>",
        "All AI models, one research workspace"
    )}
    """

    html = _base_email_template(
        preheader="Research in Collections, Knowledge Graph, smarter models — Chunk has changed since you left.",
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
        f"Chunk has new features: Research in Collections, Knowledge Graph, smarter models. Come see what's new: {BRAND['web_url']}",
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
            <td style="padding:16px;background-color:{BRAND['surface_elevated']};border-radius:12px;text-align:center">
                <p style="margin:0;font-family:{FONT_MONO};font-size:28px;font-weight:700;color:{BRAND['color_reports']};letter-spacing:-0.02em">~{searches * 5}</p>
                <p style="margin:4px 0 0 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_muted']}">Min Saved</p>
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
        footer_tip="Try Research in Collections — gather your sources in one workspace and ask AI to synthesize across all of them.",
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
                    <p style="margin:0 0 4px 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['text_muted']}">Renewal Amount</p>
                    <p style="margin:0;font-family:{FONT_MONO};font-size:28px;font-weight:700;color:{BRAND['text_inverse']}">{amount}</p>
                </td>
                <td align="right" style="vertical-align:middle">
                    <div style="width:10px;height:10px;border-radius:50%;background-color:{BRAND['signal_green']};display:inline-block"></div>
                    <span style="font-family:{FONT_MONO};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:{BRAND['signal_green']};margin-left:6px">Active</span>
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


def get_day1_superpowers_email(user_name: str = "there") -> tuple[str, str, str]:
    """
    Day 1 welcome email: 4 AI superpowers you now have.
    Focus: breadth of capabilities. Tone: empowering, exciting.
    """
    subject = "⚡ 4 AI Superpowers You Now Have"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Welcome to Chunk. You just unlocked access to the world's most powerful AI models and a research workspace that <em>thinks with you</em>. Here are <strong>4 superpowers</strong> you can use right now:
    </p>

    {_feature_card("📚", "Research in Collections", "Gather documents, notes, URLs, and past conversations into one Collection — then chat with AI that has already read all of it. Ask questions across everything at once.", BRAND['color_documents'], "SUPERPOWER 01")}
    {_feature_card("📝", "Connected Notes + Knowledge Graph", "Write notes with wiki-links ([[like this]]). Watch a living knowledge graph visualize how your ideas connect. AI writing tools help you think — not replace your thinking.", BRAND['color_notes'], "SUPERPOWER 02")}
    {_feature_card("🔬", "Deep Research Mode", "Ask a complex question and get a comprehensive, multi-source report with citations. What used to take hours of tab-hopping now takes minutes.", BRAND['color_reports'], "SUPERPOWER 03")}
    {_feature_card("🧠", "Every AI Model, One App", "GPT-5, Claude, Gemini, Llama — switch between them per conversation. Different models excel at different tasks. Chunk lets you use the right one every time.", BRAND['purple'], "SUPERPOWER 04")}

    {_content_type_legend()}

    {_dark_card(f"""
        <p style="margin:0 0 8px 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['primary']};font-weight:700">YOUR FIRST MISSION</p>
        <p style="margin:0;font-family:{FONT_SANS};font-size:15px;color:{BRAND['text_inverse']};line-height:1.6">Create a Collection. Add a few documents or URLs about something you're researching. Then ask Chunk a question about them. That's the moment it clicks.</p>
    """)}
    """

    html = _base_email_template(
        preheader="Welcome to Chunk — 4 AI superpowers you can use right now. Collections, Connected Notes, Deep Research, and every AI model.",
        hero_title="4 AI Superpowers You Now Have",
        hero_subtitle="Welcome to Chunk — let's get you started.",
        body_content=body,
        cta_text="Open Chunk",
        cta_url=BRAND["app_store_url"],
        footer_tip="Every AI response has a Save to Notes button at the bottom — tap it to instantly turn any chat response into a note in your library.",
        hero_dark=True,
        hero_label="WELCOME · DAY 1",
        hero_serif_word="Superpowers",
    )

    return (
        subject,
        html,
        f"Welcome to Chunk! 4 AI superpowers: Research in Collections, Connected Notes + Knowledge Graph, Deep Research, and every AI model in one app. {BRAND['app_store_url']}",
    )


def get_day3_collections_email(user_name: str = "there") -> tuple[str, str, str]:
    """
    Day 3 email: Deep dive on Collections + Research in Collections.
    Focus: depth of one killer feature. Tone: educational, practical.
    """
    subject = "📚 Meet Collections — Your Research Command Center"

    body = f"""
    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Hey {user_name},
    </p>
    <p style="margin:0 0 24px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Here's the feature that transforms Chunk from a chat app into a <strong>research powerhouse</strong>: Collections.
    </p>

    {_serif_statement("One workspace. Every source. Total command.", "Total command.")}

    <p style="margin:0 0 20px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']};line-height:1.6" class="text-dark">
        Think of Collections as intelligent research workspaces. Gather everything about a topic in one place — then chat with AI that has <em>already read all of it</em>.
    </p>

    <!-- What goes into a Collection -->
    <p style="margin:0 0 12px 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{BRAND['text_muted']};font-weight:700">What goes into a collection</p>

    {_feature_card("📝", "Your Notes", "Add notes you've written — Chunk understands the full text and wiki-link connections.", BRAND['color_notes'])}
    {_feature_card("📄", "Documents & PDFs", "Upload research papers, contracts, reports. Chunk extracts and indexes everything.", BRAND['color_documents'])}
    {_feature_card("🔗", "Web Articles & URLs", "Save any webpage. Chunk automatically extracts and processes the content. Share directly from Safari.", BRAND['color_urls'])}
    {_feature_card("🧪", "Research Reports", "Add previously generated Deep Research reports as context for deeper follow-up.", BRAND['color_reports'])}
    {_feature_card("💬", "Past Conversations", "Pull in previous AI chats. Pick up where you left off, with full history as context.", BRAND['color_conversations'])}

    {_content_type_legend()}

    <!-- How people use Collections -->
    {_dark_card(f"""
        <p style="margin:0 0 12px 0;font-family:{FONT_MONO};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:{BRAND['signal_green']};font-weight:700">HOW PEOPLE USE COLLECTIONS</p>
        <p style="margin:0 0 6px 0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_inverse']};line-height:1.8">📖 <strong>Research projects</strong> — gather all papers and sources, ask AI to find connections</p>
        <p style="margin:0 0 6px 0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_inverse']};line-height:1.8">🎓 <strong>Study materials</strong> — organize course content, generate study guides on demand</p>
        <p style="margin:0 0 6px 0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_inverse']};line-height:1.8">✍️ <strong>Content creation</strong> — collect references, synthesize into articles</p>
        <p style="margin:0;font-family:{FONT_SANS};font-size:14px;color:{BRAND['text_inverse']};line-height:1.8">💼 <strong>Work projects</strong> — build team knowledge bases with full AI access</p>
    """)}
    """

    html = _base_email_template(
        preheader="Collections: gather notes, documents, URLs, and chats into one workspace — then research across all of it with AI.",
        hero_title="Meet Collections",
        hero_subtitle="Your AI-powered research command center.",
        body_content=body,
        cta_text="Create Your First Collection",
        cta_url=BRAND["web_url"],
        footer_tip="Use Safari's Share button to add articles directly to a Collection. Chunk automatically extracts and indexes the content.",
        hero_dark=False,
        hero_label="WELCOME · DAY 3",
    )

    return (
        subject,
        html,
        f"Discover Collections — gather notes, documents, URLs, and conversations in one workspace, then research across all of it with AI. {BRAND['web_url']}",
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
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;background-color:#FFF3E0;border-radius:16px;border-left:6px solid #FF9800;overflow:hidden">
        <tr>
            <td style="padding:20px 24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:16px;font-weight:700;color:#E65100">⏰ Please update within 3 days</p>
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
    {_feature_card("🧠", "Model Switching", "GPT-5 for analysis, Claude for writing, Gemini for coding — switch per conversation. The right model for every task.", BRAND['purple'], "TRY THIS")}

    {_serif_statement("Your workspace is ready and waiting.", "ready and waiting.")}
    """

    html = _base_email_template(
        preheader="Your Chunk research workspace is waiting. Collections, Connected Notes, Deep Research — features you haven't tried yet.",
        hero_title="Your Research Workspace is Waiting",
        hero_subtitle="Features you might not have discovered yet.",
        body_content=body,
        cta_text="Open Chunk",
        cta_url=BRAND["app_store_url"],
        footer_tip="Try Research in Collections — create a Collection, add a few sources, and ask Chunk to synthesize across everything.",
        hero_dark=True,
    )

    return (
        subject,
        html,
        f"Your Chunk research workspace is waiting. Collections, Connected Notes, Deep Research, and more: {BRAND['app_store_url']}",
    )


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
        cta_url=BRAND["app_store_url"],
        hero_dark=True,
        hero_label="NEW FEATURE",
    )

    return (
        subject,
        html,
        f"New in Chunk: {feature_name} — {feature_description}. Update and try it now: {BRAND['app_store_url']}",
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
    {_protocol_step("03", "Deep Research + Every AI Model", "Comprehensive research reports with citations, plus GPT-5, Claude, Gemini, and Llama — all in one app.")}

    <!-- Trial CTA Card -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0 0;background-color:#E8F5E9;border-radius:16px;border-left:6px solid {BRAND['signal_green']};overflow:hidden">
        <tr>
            <td style="padding:24px">
                <p style="margin:0 0 8px 0;font-family:{FONT_SANS};font-size:18px;font-weight:700;color:#2E7D32">🎁 Your free trial is waiting</p>
                <p style="margin:0 0 4px 0;font-family:{FONT_SANS};font-size:16px;color:{BRAND['text_primary']}" class="text-dark"><strong>3 days of full Pro access</strong> — no credit card required.</p>
                <p style="margin:0;font-family:{FONT_MONO};font-size:12px;color:{BRAND['text_muted']}">No commitment. Cancel anytime.</p>
            </td>
        </tr>
    </table>
    """

    html = _base_email_template(
        preheader="Your free 3-day Pro trial is waiting. Research in Collections, Connected Notes, Deep Research — no credit card needed.",
        hero_title="You Left Something on the Table",
        hero_subtitle="Your free Pro trial is waiting for you.",
        body_content=body,
        cta_text="Start Free Trial",
        cta_url=BRAND["app_store_url"],
        footer_tip="The trial is completely free — no credit card needed. Full access to every AI model and feature for 3 days.",
        hero_dark=False,
        hero_label="DON'T MISS OUT",
    )

    return (
        subject,
        html,
        f"You signed up for Chunk but haven't started your free Pro trial yet. 3 days of full access, no credit card required: {BRAND['app_store_url']}",
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

    # Inject unsubscribe link into HTML body (white text — footer is dark bg)
    unsubscribe_link_html = f'<a href="{unsubscribe_url}" style="color:{BRAND["text_inverse"]};text-decoration:none">Unsubscribe</a><span style="color:{BRAND["text_inverse"]};opacity:0.3"> · </span>'
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

    # Inject unsubscribe link into HTML body (white text — footer is dark bg)
    unsubscribe_link_html = f'<a href="{unsubscribe_url}" style="color:{BRAND["text_inverse"]};text-decoration:none">Unsubscribe</a><span style="color:{BRAND["text_inverse"]};opacity:0.3"> · </span>'
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


def send_day1_superpowers(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send Day 1 welcome sequence email."""
    subject, html, text = get_day1_superpowers_email(user_name)
    return send_email(to_email, subject, html, text, email_type="day1_superpowers", user_id=user_id)


def send_day3_collections(to_email: str, user_name: str = "there", user_id: str = None) -> dict:
    """Send Day 3 Collections email."""
    subject, html, text = get_day3_collections_email(user_name)
    return send_email(to_email, subject, html, text, email_type="day3_collections", user_id=user_id)


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
