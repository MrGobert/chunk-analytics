"""
Minimal RevenueCat v2 REST client for the analytics API.

Read-only: fetches a customer's current subscription state so the dashboard
can show live renewal/expiry info alongside the Firestore webhook mirror.
Degrades to None on any failure — callers fall back to Firestore data.
"""

import logging
import os
from urllib.parse import quote

import httpx

REVENUECAT_API_BASE = "https://api.revenuecat.com/v2"
REQUEST_TIMEOUT_SECONDS = 5.0


def _config() -> tuple[str, str]:
    return (
        os.environ.get("REVENUECAT_SECRET_API_KEY", ""),
        os.environ.get("REVENUECAT_PROJECT_ID", ""),
    )


def _customer_attribute(customer: dict, name: str):
    attributes = customer.get("attributes") or {}
    items = attributes.get("items", []) if isinstance(attributes, dict) else []
    for attribute in items:
        if attribute.get("name") == name:
            return attribute.get("value")
    return None


def _customer_profile(customer: dict, app_user_id: str = "") -> dict | None:
    customer_id = customer.get("id")
    if not customer_id:
        return None
    return {
        # Keep the App User ID used for the lookup separate from RevenueCat's
        # canonical customer id. They can differ after customer aliasing.
        "uid": app_user_id or customer_id,
        "revenueCatCustomerId": customer_id,
        "email": _customer_attribute(customer, "$email") or "",
        "displayName": (
            _customer_attribute(customer, "$displayName")
            or _customer_attribute(customer, "display_name")
            or ""
        ),
        "platform": customer.get("last_seen_platform") or "unknown",
        "createdAt": customer.get("first_seen_at"),
        "lastActiveAt": customer.get("last_seen_at"),
        "source": "revenuecat",
    }


def get_customer_profile(app_user_id: str) -> dict | None:
    """Fetch one RevenueCat customer by exact App User ID/customer alias."""
    api_key, project_id = _config()
    value = (app_user_id or "").strip()
    if not value or not api_key or not project_id:
        return None

    url = (
        f"{REVENUECAT_API_BASE}/projects/{quote(project_id, safe='')}"
        f"/customers/{quote(value, safe='')}"
    )
    try:
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            params={"expand": "attributes"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logging.warning(
            f"[ANALYTICS_API] RevenueCat customer lookup failed for {value}: {exc}"
        )
        return None

    if response.status_code == 404:
        return None
    if response.status_code != 200:
        logging.warning(
            "[ANALYTICS_API] RevenueCat customer lookup returned "
            f"{response.status_code} for {value}"
        )
        return None

    try:
        customer = response.json()
    except Exception as exc:
        logging.warning(
            f"[ANALYTICS_API] RevenueCat customer response was unparseable: {exc}"
        )
        return None
    return _customer_profile(customer, app_user_id=value)


def search_customer(query: str) -> dict | None:
    """Resolve an exact App User ID or $email using RevenueCat customer search."""
    api_key, project_id = _config()
    value = (query or "").strip()
    if not value or not api_key or not project_id:
        return None

    # V2 customer reads accept an App User ID (including a merged alias).
    # Preserve that entered ID for Firebase/Mixpanel correlation even if the
    # returned RevenueCat customer has a different canonical id.
    direct = get_customer_profile(value)
    if direct:
        return direct

    # The list endpoint can also match transaction/order identifiers. Only use
    # it for the email fallback so a transaction id is never mistaken for a
    # cross-system UID.
    if "@" not in value:
        return None

    url = (
        f"{REVENUECAT_API_BASE}/projects/{quote(project_id, safe='')}/customers"
    )
    try:
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            params={"search": value, "limit": 100},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logging.warning(
            f"[ANALYTICS_API] RevenueCat customer search failed for {value}: {exc}"
        )
        return None

    if response.status_code != 200:
        logging.warning(
            "[ANALYTICS_API] RevenueCat customer search returned "
            f"{response.status_code} for {value}"
        )
        return None

    try:
        items = response.json().get("items", [])
    except Exception as exc:
        logging.warning(
            f"[ANALYTICS_API] RevenueCat customer search was unparseable: {exc}"
        )
        return None

    normalized = value.casefold()
    exact_email = next(
        (
            customer for customer in items
            if str(_customer_attribute(customer, "$email") or "").casefold()
            == normalized
        ),
        None,
    )
    return _customer_profile(exact_email or {})


def get_current_subscription(uid: str) -> dict | None:
    """Fetch the customer's current subscription from RevenueCat v2.

    Returns None when unconfigured or on any error; {"userExists": False}
    when RevenueCat has no customer for this uid. Timestamps are returned
    raw (epoch milliseconds) — callers serialize them.
    """
    api_key, project_id = _config()
    if not uid or not api_key or not project_id:
        return None

    encoded_project = quote(project_id, safe="")
    encoded_uid = quote(uid, safe="")
    url = (
        f"{REVENUECAT_API_BASE}/projects/{encoded_project}"
        f"/customers/{encoded_uid}/subscriptions"
    )
    try:
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            params={"environment": "production", "limit": 100},
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

    if not items:
        return {
            "userExists": True,
            "isSubscribed": False,
            "status": "not_subscribed",
            "willRenew": False,
        }

    def recency(sub: dict):
        return (
            sub.get("current_period_ends_at")
            or sub.get("ends_at")
            or sub.get("current_period_starts_at")
            or sub.get("starts_at")
            or 0
        )

    accessible = [sub for sub in items if sub.get("gives_access") is True]
    selected = max(accessible or items, key=recency)
    renewal_status = selected.get("auto_renewal_status")
    if renewal_status is None:
        will_renew = None
    else:
        will_renew = renewal_status in {
            "will_renew", "will_change_product", "has_already_renewed",
        }

    return {
        "userExists": True,
        "isSubscribed": bool(selected.get("gives_access")),
        "status": selected.get("status"),
        "store": selected.get("store"),
        "productId": selected.get("product_id"),
        "currentPeriodStartsAt": selected.get("current_period_starts_at"),
        "currentPeriodEndsAt": (
            selected.get("current_period_ends_at") or selected.get("ends_at")
        ),
        "willRenew": will_renew,
        "autoRenewalStatus": renewal_status,
        "isSandbox": str(selected.get("environment") or "production").lower()
        == "sandbox",
    }
