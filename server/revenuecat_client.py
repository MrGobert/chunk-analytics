"""
Minimal RevenueCat v2 REST client for the analytics API.

Read-only: fetches a customer's current subscription state so the dashboard
can show live renewal/expiry info alongside the Firestore webhook mirror.
Degrades to None on any failure — callers fall back to Firestore data.
"""

import logging
import os

import httpx

REVENUECAT_API_BASE = "https://api.revenuecat.com/v2"
REQUEST_TIMEOUT_SECONDS = 5.0


def _config() -> tuple[str, str]:
    return (
        os.environ.get("REVENUECAT_SECRET_API_KEY", ""),
        os.environ.get("REVENUECAT_PROJECT_ID", ""),
    )


def get_current_subscription(uid: str) -> dict | None:
    """Fetch the customer's current subscription from RevenueCat v2.

    Returns None when unconfigured or on any error; {"userExists": False}
    when RevenueCat has no customer for this uid. Timestamps are returned
    raw (epoch milliseconds) — callers serialize them.
    """
    api_key, project_id = _config()
    if not uid or not api_key or not project_id:
        return None

    url = f"{REVENUECAT_API_BASE}/projects/{project_id}/customers/{uid}/subscriptions"
    try:
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logging.warning(f"[ANALYTICS_API] RevenueCat request failed for {uid}: {exc}")
        return None

    if response.status_code == 404:
        return {"userExists": False}
    if response.status_code != 200:
        logging.warning(
            f"[ANALYTICS_API] RevenueCat returned {response.status_code} for {uid}"
        )
        return None

    try:
        items = response.json().get("items", [])
    except Exception as exc:
        logging.warning(f"[ANALYTICS_API] RevenueCat response unparseable for {uid}: {exc}")
        return None

    for sub in items:
        if sub.get("gives_access") is True or str(sub.get("status", "")).lower() == "active":
            return {
                "userExists": True,
                "isSubscribed": True,
                "status": sub.get("status"),
                "store": sub.get("store"),
                "productId": sub.get("product_id"),
                "currentPeriodStartsAt": sub.get("current_period_starts_at"),
                "currentPeriodEndsAt": sub.get("current_period_ends_at"),
                "willRenew": sub.get("auto_resume_at") is None,
                "isSandbox": sub.get("environment") == "sandbox",
            }

    return {"userExists": True, "isSubscribed": False}
