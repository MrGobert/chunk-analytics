"""
Standalone auth module for analytics API.

Verifies Authorization header against REVENUECAT_WEBHOOK_AUTH env var
using constant-time comparison.
"""

import hmac
import os


def verify_auth(request) -> bool:
    """Verify the Authorization header against REVENUECAT_WEBHOOK_AUTH env var.

    Args:
        request: Flask request object.

    Returns:
        True if authorized, False otherwise.
    """
    expected = os.environ.get("REVENUECAT_WEBHOOK_AUTH", "")
    if not expected:
        return False

    auth_header = request.headers.get("Authorization", "")
    return hmac.compare_digest(auth_header, expected)
