"""
Analytics API Blueprint for Chunk AI Command Center.

Isolated read-only endpoints that query Firestore to serve the
chunk-analytics dashboard. NO dependency on chat pipeline.

All endpoints wrap in try/except and return graceful empty data on error.
"""

import heapq
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from functools import wraps
from statistics import median

from flask import Blueprint, jsonify, request

analytics_api_bp = Blueprint("analytics_api", __name__)

# Default monthly price assumption when subscriptionPrice is absent
DEFAULT_MONTHLY_PRICE = 9.99


# ---- Helpers ----


def _to_datetime(val) -> datetime:
    """Convert Firestore timestamp or string to datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val
    if hasattr(val, "seconds"):
        # Firestore Timestamp proto
        return datetime.fromtimestamp(val.seconds + val.nanos / 1e9, tz=timezone.utc)
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val / 1000 if val > 1e12 else val, tz=timezone.utc)
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError):
            return None
    return None


def _safe_isoformat(val) -> str:
    """Convert a value to ISO format string, or return empty string."""
    dt = _to_datetime(val)
    return dt.isoformat() if dt else ""


def _get_redis():
    """Get Redis client, return None if unavailable."""
    try:
        from redis_setup import redis_client
        if redis_client and redis_client.ping():
            return redis_client
    except Exception:
        pass
    return None


def _get_cached_or_compute(cache_key, compute_fn, *args, ttl=900):
    """Try Redis cache -> live compute. Returns dict."""
    redis = _get_redis()

    # Try Redis
    if redis:
        try:
            cached = redis.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    # Live compute
    result = compute_fn(*args)

    # Write to Redis
    if redis and result:
        try:
            redis.setex(cache_key, ttl, json.dumps(result, default=str))
        except Exception:
            pass

    return result


# ---- Auth decorator (reuses existing verify_webhook_auth) ----


def require_analytics_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        from auth import verify_auth
        if not verify_auth(request):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


# ---- Safety wrapper for all analytics endpoints ----


def safe_analytics(empty_response):
    """Decorator: catch all exceptions, return empty_response instead of 500."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            try:
                return f(*args, **kwargs)
            except Exception as e:
                logging.error(f"[ANALYTICS_API] {f.__name__} failed: {e}", exc_info=True)
                return jsonify({**empty_response, "note": "Data temporarily unavailable", "dataUnavailable": True}), 200
        return decorated
    return decorator


# ============================================================
# Health Score Algorithm
# ============================================================


def _get_creation_date(user_data: dict) -> datetime:
    """Get account creation date, checking common field name variants."""
    return (
        _to_datetime(user_data.get("createdAt"))
        or _to_datetime(user_data.get("created_at"))
        or _to_datetime(user_data.get("signupDate"))
    )


def _get_tenure_date(user_data: dict) -> datetime:
    """Get subscription start date for tenure calculation (always a past date)."""
    # Prefer creation/signup date — renewalDate is typically a future billing date
    return (
        _get_creation_date(user_data)
        or _to_datetime(user_data.get("trialEndDate"))
    )


def _compute_health_score(user_data: dict, now: datetime) -> dict:
    """Compute health score from 5 weighted factors."""

    # Factor 1: Recency (35% weight) - How recently was user active?
    last_active = _to_datetime(user_data.get("lastActiveAt"))
    if last_active:
        days_since = (now - last_active).days
        recency = max(0, 100 - (days_since * 3.3))  # 0 after 30 days
    else:
        recency = 0

    # Factor 2: Tenure (10% weight) - How long subscribed?
    tenure_date = _get_tenure_date(user_data)
    if tenure_date:
        tenure_days = (now - tenure_date).days
        tenure = min(100, tenure_days * 0.67)  # Maxes at ~150 days
    else:
        tenure = 50  # Unknown

    # Recency gate: halve tenure when user is 30+ days inactive or never seen
    if recency == 0:
        tenure = tenure * 0.5

    # Factor 3: Usage Frequency (25% weight) - Monthly activity
    usage = user_data.get("usageStats", {}) or {}
    searches = usage.get("monthlySearches", 0) or 0
    frequency = min(100, searches * 5)  # 20+ searches/month = 100

    # Factor 4: Feature Depth (20% weight) - Uses multiple features?
    features_used = sum(1 for k in ["monthlySearches", "monthlyDocuments",
                        "monthlyImages", "monthlyNotes", "monthlyCollections"]
                       if (usage.get(k, 0) or 0) > 0)
    feature_depth = min(100, features_used * 25)  # 4+ features = 100

    # Factor 5: Email Engagement (10% weight)
    emails_sent = user_data.get("emailsSent", {}) or {}
    email_engagement = min(100, len(emails_sent) * 15)

    score = (recency * 0.35 + tenure * 0.10 + frequency * 0.25 +
             feature_depth * 0.20 + email_engagement * 0.10)

    status = "healthy" if score >= 60 else "atRisk" if score >= 30 else "churning"

    return {
        "healthScore": round(score),
        "healthStatus": status,
        "factors": {
            "recency": round(recency),
            "frequency": round(frequency),
            "featureDepth": round(feature_depth),
            "tenure": round(tenure),
            "emailEngagement": round(email_engagement),
        }
    }


# ============================================================
# Endpoint 1: Revenue Summary
# ============================================================


@analytics_api_bp.route("/revenue-summary", methods=["GET"])
@require_analytics_auth
@safe_analytics({
    "mrr": 0, "mrrChange": 0, "arr": 0, "todayRevenue": 0,
    "totalSubscribers": 0, "trialUsers": 0, "churnRate": 0,
    "byPlatform": {}, "byProduct": {}, "mrrTrend": [],
    "newSubscribers": 0, "churned": 0, "netNew": 0,
})
def revenue_summary():
    days = request.args.get("days", 30, type=int)
    days = min(max(days, 1), 365)

    cache_key = f"analytics_cache:revenue_summary:{days}"
    result = _get_cached_or_compute(cache_key, _compute_revenue_summary, days, ttl=900)
    return jsonify(result), 200


def _compute_revenue_summary(days: int) -> dict:
    from firebase_setup import db

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    prior_start = cutoff - timedelta(days=days)

    # Query all users with subscription-related statuses
    users_ref = db.collection("users")

    # Active subscribers
    active_docs = list(users_ref.where("subscriptionStatus", "==", "active").limit(5000).stream())
    trial_docs = list(users_ref.where("subscriptionStatus", "==", "trial").limit(5000).stream())
    expired_docs = list(users_ref.where("subscriptionStatus", "==", "expired").limit(5000).stream())
    cancelled_docs = list(users_ref.where("subscriptionStatus", "==", "cancelled").limit(5000).stream())

    total_subscribers = len(active_docs)
    trial_users = len(trial_docs)

    # MRR calculation from active subscribers
    by_platform = {}
    by_product = {}
    mrr = 0.0

    for doc in active_docs:
        data = doc.to_dict()
        price = float(data.get("subscriptionPrice", DEFAULT_MONTHLY_PRICE) or DEFAULT_MONTHLY_PRICE)

        # Normalize annual prices to monthly equivalent for MRR
        # Annual plans are typically > $15 (e.g., $69.99/year vs $9.99/month)
        is_annual = price > 15
        monthly_price = round(price / 12, 2) if is_annual else price
        mrr += monthly_price

        platform = data.get("platform", "unknown") or "unknown"
        # byPlatform contains MRR per platform (dollar amounts, not counts)
        by_platform[platform] = round(by_platform.get(platform, 0) + monthly_price, 2)

        # byProduct contains MRR per product type (dollar amounts, not counts)
        if is_annual:
            by_product["annual"] = round(by_product.get("annual", 0) + monthly_price, 2)
        else:
            by_product["monthly"] = round(by_product.get("monthly", 0) + monthly_price, 2)

    arr = mrr * 12

    # New subscribers in period
    new_subscribers = 0
    for doc in active_docs:
        data = doc.to_dict()
        created = _get_creation_date(data)
        if created and created >= cutoff:
            new_subscribers += 1

    # Churned in period
    churned = 0
    for doc in expired_docs + cancelled_docs:
        data = doc.to_dict()
        exp_date = _to_datetime(data.get("expirationDate"))
        if exp_date and exp_date >= cutoff:
            churned += 1

    net_new = new_subscribers - churned

    # Churn rate: churned in period / (total active at start of period)
    # Approximate: total active now + churned in period = active at start
    start_active = total_subscribers + churned
    churn_rate = round((churned / start_active * 100) if start_active > 0 else 0, 1)

    # MRR change vs prior period
    prior_churned = 0
    prior_new = 0
    for doc in expired_docs + cancelled_docs:
        data = doc.to_dict()
        exp_date = _to_datetime(data.get("expirationDate"))
        if exp_date and prior_start <= exp_date < cutoff:
            prior_churned += 1
    for doc in active_docs:
        data = doc.to_dict()
        created = _get_creation_date(data)
        if created and prior_start <= created < cutoff:
            prior_new += 1

    prior_net = prior_new - prior_churned
    if prior_net != 0:
        mrr_change = round(((net_new - prior_net) / abs(prior_net)) * 100, 1)
    elif net_new > 0:
        mrr_change = 100.0
    else:
        mrr_change = 0.0

    # Today's revenue (approximate from conversions today)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_revenue = 0.0
    try:
        tracking_docs = list(
            db.collection("emailTracking")
            .where("converted", "==", True)
            .where("convertedAt", ">=", today_start)
            .limit(500)
            .stream()
        )
        today_revenue = len(tracking_docs) * DEFAULT_MONTHLY_PRICE
    except Exception:
        pass

    # MRR trend: try to load from Redis cache (populated by daily snapshot task)
    mrr_trend = []
    redis = _get_redis()
    if redis:
        try:
            trend_data = redis.get("analytics_cache:mrr_history")
            if trend_data:
                mrr_trend = json.loads(trend_data)
        except Exception:
            pass

    # If no historical data, return single point for today
    if not mrr_trend:
        mrr_trend = [{"date": now.strftime("%Y-%m-%d"), "mrr": round(mrr, 2)}]

    return {
        "mrr": round(mrr, 2),
        "mrrChange": mrr_change,
        "arr": round(arr, 2),
        "todayRevenue": round(today_revenue, 2),
        "totalSubscribers": total_subscribers,
        "trialUsers": trial_users,
        "churnRate": churn_rate,
        "byPlatform": by_platform,
        "byProduct": by_product,
        "mrrTrend": mrr_trend,
        "newSubscribers": new_subscribers,
        "churned": churned,
        "netNew": net_new,
    }


# ============================================================
# Endpoint 2: Subscriber Funnel
# ============================================================


@analytics_api_bp.route("/subscriber-funnel", methods=["GET"])
@require_analytics_auth
@safe_analytics({
    "funnel": [], "trialConversionRate": 0, "medianDaysToConvert": 0,
    "conversionByPlatform": {}, "weekOverWeek": {"trialStarts": 0, "conversions": 0},
})
def subscriber_funnel():
    days = request.args.get("days", 30, type=int)
    days = min(max(days, 1), 365)

    cache_key = f"analytics_cache:subscriber_funnel:{days}"
    result = _get_cached_or_compute(cache_key, _compute_subscriber_funnel, days, ttl=900)
    return jsonify(result), 200


def _compute_subscriber_funnel(days: int) -> dict:
    from firebase_setup import db

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    week_ago = now - timedelta(days=7)
    two_weeks_ago = now - timedelta(days=14)

    users_ref = db.collection("users")

    # Get all users created in period
    all_users_in_period = list(
        users_ref.where("createdAt", ">=", cutoff).limit(5000).stream()
    )

    signed_up = len(all_users_in_period)

    # Count by subscription status for funnel stages
    started_trial = 0
    converted_to_paid = 0
    active_30d = 0
    churned_count = 0
    conversion_by_platform = {}

    for doc in all_users_in_period:
        data = doc.to_dict()
        status = data.get("subscriptionStatus", "")

        if status in ("trial", "active", "expired", "cancelled"):
            started_trial += 1

        if status == "active":
            converted_to_paid += 1
            platform = data.get("platform", "unknown") or "unknown"
            conversion_by_platform[platform] = conversion_by_platform.get(platform, 0) + 1

            # Check if active in last 30 days
            last_active = _to_datetime(data.get("lastActiveAt"))
            if last_active and last_active >= (now - timedelta(days=30)):
                active_30d += 1

        if status in ("expired", "cancelled"):
            churned_count += 1

    trial_conversion_rate = round(
        (converted_to_paid / started_trial * 100) if started_trial > 0 else 0, 1
    )

    # Build funnel stages
    funnel = []
    stages = [
        ("Signed Up", signed_up),
        ("Started Trial", started_trial),
        ("Converted to Paid", converted_to_paid),
        ("Active (30d)", active_30d),
        ("Churned", churned_count),
    ]
    for stage_name, count in stages:
        rate = round((count / signed_up * 100) if signed_up > 0 else 0, 1)
        funnel.append({"stage": stage_name, "count": count, "rate": rate})

    # Median days to convert from emailTracking
    median_days = 0
    try:
        conversion_docs = list(
            db.collection("emailTracking")
            .where("conversionEvent", "==", "TRIAL_CONVERTED")
            .where("sentAt", ">=", cutoff)
            .limit(1000)
            .stream()
        )
        days_list = []
        for doc in conversion_docs:
            data = doc.to_dict()
            dtc = data.get("daysToConvert")
            if dtc is not None and dtc > 0:
                days_list.append(dtc)
        if days_list:
            median_days = round(median(days_list), 1)
    except Exception:
        pass

    # Week over week comparison
    this_week_trials = 0
    this_week_conversions = 0
    last_week_trials = 0
    last_week_conversions = 0

    for doc in all_users_in_period:
        data = doc.to_dict()
        created = _get_creation_date(data)
        status = data.get("subscriptionStatus", "")

        if created and created >= week_ago:
            if status in ("trial", "active", "expired", "cancelled"):
                this_week_trials += 1
            if status == "active":
                this_week_conversions += 1
        elif created and created >= two_weeks_ago:
            if status in ("trial", "active", "expired", "cancelled"):
                last_week_trials += 1
            if status == "active":
                last_week_conversions += 1

    wow_trials = round(
        ((this_week_trials - last_week_trials) / last_week_trials * 100)
        if last_week_trials > 0 else 0, 1
    )
    wow_conversions = round(
        ((this_week_conversions - last_week_conversions) / last_week_conversions * 100)
        if last_week_conversions > 0 else 0, 1
    )

    # Convert platform counts to percentages
    total_converted = sum(conversion_by_platform.values())
    conv_pct_by_platform = {}
    if total_converted > 0:
        for platform, count in conversion_by_platform.items():
            conv_pct_by_platform[platform] = round(count / total_converted * 100, 1)

    return {
        "funnel": funnel,
        "trialConversionRate": trial_conversion_rate,
        "medianDaysToConvert": median_days,
        "conversionByPlatform": conv_pct_by_platform,
        "weekOverWeek": {"trialStarts": wow_trials, "conversions": wow_conversions},
    }


# ============================================================
# Endpoint 3: Churn Intelligence
# ============================================================


@analytics_api_bp.route("/churn-intelligence", methods=["GET"])
@require_analytics_auth
@safe_analytics({
    "churnRate": 0, "churnRateTrend": [], "atRiskUsers": [], "churnedUsers": [],
    "winbackEffectiveness": {}, "churnReasons": {},
    "avgTenureBeforeChurn": 0, "atRiskCount": 0, "trialAtRiskCount": 0, "winbackRate": 0,
    "topEngagedUsers": [], "engagedCount": 0,
})
def churn_intelligence():
    days = request.args.get("days", 90, type=int)
    days = min(max(days, 1), 365)

    cache_key = f"analytics_cache:churn_intelligence:{days}"
    result = _get_cached_or_compute(cache_key, _compute_churn_intelligence, days, ttl=900)
    return jsonify(result), 200


def _classify_churn_reason(data: dict, now: datetime) -> str:
    """Classify churn reason from user data with enriched signal hierarchy."""
    usage = data.get("usageStats", {}) or {}
    emails_sent = data.get("emailsSent", {}) or {}
    searches = usage.get("monthlySearches", 0) or 0
    documents = usage.get("monthlyDocuments", 0) or 0
    notes = usage.get("monthlyNotes", 0) or 0
    total_usage = searches + documents + notes

    # Check if this was a trial user
    trial_end = _to_datetime(data.get("trialEndDate"))
    exp_date = _to_datetime(data.get("expirationDate"))
    created = _get_creation_date(data)
    is_trial_churn = (
        trial_end and exp_date
        and abs((trial_end - exp_date).total_seconds()) < 86400 * 2  # expiration ≈ trial end
    )

    # Priority 1: Billing issue
    if emails_sent.get("billingIssue"):
        return "Billing issue"

    # Priority 2-4: Trial-specific reasons
    if is_trial_churn:
        if searches == 0:
            return "Trial - no usage"
        if searches < 5:
            return "Trial - low engagement"
        return "Trial - did not convert"

    # Priority 5: No usage at all
    if total_usage == 0:
        return "No usage"

    # Priority 6: Low usage
    if searches < 5 and total_usage < 10:
        return "Low usage"

    # Priority 7: Went inactive before churning
    last_active = _to_datetime(data.get("lastActiveAt"))
    if last_active and exp_date and (exp_date - last_active).days >= 30:
        return "Went inactive"

    # Priority 8: Short tenure
    if created and exp_date and (exp_date - created).days < 30:
        return "Short tenure (<30d)"

    # Priority 9: Active user with no clear reason
    if searches >= 5:
        return "Active user - unknown reason"

    # Priority 10: Fallback
    return "Unknown"


def _compute_churn_intelligence(days: int) -> dict:
    from firebase_setup import db

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    seven_days_ago = now - timedelta(days=7)
    fourteen_days_ago = now - timedelta(days=14)

    users_ref = db.collection("users")

    # Active subscribers + trial users
    active_docs = list(users_ref.where("subscriptionStatus", "==", "active").limit(5000).stream())
    trial_docs = list(users_ref.where("subscriptionStatus", "==", "trial").limit(5000).stream())

    # Churned users in period
    expired_docs = list(users_ref.where("subscriptionStatus", "==", "expired").limit(5000).stream())
    cancelled_docs = list(users_ref.where("subscriptionStatus", "==", "cancelled").limit(5000).stream())

    churned_in_period = []
    for doc in expired_docs + cancelled_docs:
        data = doc.to_dict()
        data["_uid"] = doc.id
        exp_date = _to_datetime(data.get("expirationDate"))
        if exp_date and exp_date >= cutoff:
            churned_in_period.append(data)

    # Separate trial expirations from subscriber churn for accurate churn rate
    subscriber_churned = []
    trial_churned = []
    for data in churned_in_period:
        trial_end = _to_datetime(data.get("trialEndDate"))
        exp_date = _to_datetime(data.get("expirationDate"))
        is_trial_expiry = (
            trial_end and exp_date
            and abs((trial_end - exp_date).total_seconds()) < 86400 * 2
        )
        if is_trial_expiry:
            trial_churned.append(data)
        else:
            subscriber_churned.append(data)

    # Churn rate: only paying subscribers who churned (not trial expirations)
    total_subscriber_churned = len(subscriber_churned)
    start_active = len(active_docs) + total_subscriber_churned
    churn_rate = round((total_subscriber_churned / start_active * 100) if start_active > 0 else 0, 1)

    # Single pass: classify active + trial users as at-risk or engaged
    at_risk_users = []
    trial_at_risk_count = 0
    engaged_candidates = []
    for doc in active_docs + trial_docs:
        data = doc.to_dict()
        last_active = _to_datetime(data.get("lastActiveAt"))
        health = _compute_health_score(data, now)
        tenure_date = _get_tenure_date(data)
        sub_age = (now - tenure_date).days if tenure_date else None
        platform = data.get("platform", "unknown") or "unknown"
        sub_status = data.get("subscriptionStatus", "active")
        is_trial = sub_status == "trial"

        # Trial-specific: days until trial ends
        trial_end = _to_datetime(data.get("trialEndDate"))
        trial_ends_in = (trial_end - now).days if trial_end else None

        # Trial users within 3 days of expiration are at-risk regardless of activity
        trial_expiring_soon = is_trial and trial_ends_in is not None and trial_ends_in <= 3

        if trial_expiring_soon or last_active is None or last_active < seven_days_ago:
            # At-risk: inactive 7+ days OR trial expiring soon
            at_risk_users.append({
                "uid": doc.id,
                "email": data.get("email", ""),
                "lastActive": _safe_isoformat(last_active),
                "daysSinceActive": (now - last_active).days if last_active else None,
                "healthScore": health["healthScore"],
                "subscriptionAge": sub_age,
                "platform": platform,
                "subscriptionType": "trial" if is_trial else "active",
                "trialEndsIn": trial_ends_in if is_trial else None,
            })
            if trial_expiring_soon:
                trial_at_risk_count += 1
        elif not is_trial and health["healthScore"] >= 40 and last_active and last_active >= fourteen_days_ago:
            # Engaged: active paying subscribers within 14 days with decent health
            usage = data.get("usageStats", {}) or {}
            engaged_candidates.append({
                "uid": doc.id,
                "email": data.get("email", ""),
                "lastActive": _safe_isoformat(last_active),
                "daysSinceActive": (now - last_active).days,
                "healthScore": health["healthScore"],
                "subscriptionAge": sub_age,
                "platform": platform,
                "usage": {
                    "searches": usage.get("monthlySearches", 0) or 0,
                    "documents": usage.get("monthlyDocuments", 0) or 0,
                    "notes": usage.get("monthlyNotes", 0) or 0,
                    "collections": usage.get("monthlyCollections", 0) or 0,
                },
                "factors": health["factors"],
            })

    # Null health scores sort to top (most uncertain = most risky)
    at_risk_users.sort(key=lambda x: (
        x["healthScore"] if x["healthScore"] is not None else -1
    ))

    engaged_count = len(engaged_candidates)
    top_engaged_users = heapq.nlargest(
        50, engaged_candidates, key=lambda x: x["healthScore"]
    )

    # Churned users detail with email history
    # Batch email history lookup to avoid N+1 queries
    churned_subset = churned_in_period[:100]  # Cap at 100
    churned_uids = [d["_uid"] for d in churned_subset]

    # Batch query: Firestore 'in' supports up to 30 values per query
    email_by_user = {}  # uid -> {"received": [...], "opened": [...]}
    try:
        for i in range(0, len(churned_uids), 30):
            batch_uids = churned_uids[i:i + 30]
            email_docs = list(
                db.collection("emailTracking")
                .where("userId", "in", batch_uids)
                .limit(3000)
                .stream()
            )
            for edoc in email_docs:
                edata = edoc.to_dict()
                uid = edata.get("userId", "")
                email_type = edata.get("emailType", "")
                if uid not in email_by_user:
                    email_by_user[uid] = {"received": [], "opened": []}
                email_by_user[uid]["received"].append(email_type)
                if edata.get("opened"):
                    email_by_user[uid]["opened"].append(email_type)
    except Exception:
        pass

    # Pre-compute churn reasons for all churned users (avoids double classification)
    reason_by_uid = {d["_uid"]: _classify_churn_reason(d, now) for d in churned_in_period}

    churned_users = []
    for data in churned_subset:
        uid = data["_uid"]
        created = _get_creation_date(data)
        exp_date = _to_datetime(data.get("expirationDate"))
        tenure = (exp_date - created).days if (exp_date and created) else 0

        user_emails = email_by_user.get(uid, {"received": [], "opened": []})
        usage = data.get("usageStats", {}) or {}
        churned_users.append({
            "uid": uid,
            "email": data.get("email", ""),
            "churnDate": _safe_isoformat(exp_date),
            "tenure": tenure,
            "reason": reason_by_uid[uid],
            "emailsReceived": user_emails["received"],
            "emailsOpened": user_emails["opened"],
            "platform": data.get("platform", "unknown") or "unknown",
            "usage": {
                "searches": usage.get("monthlySearches", 0) or 0,
                "notes": usage.get("monthlyNotes", 0) or 0,
            },
        })

    # Winback effectiveness from emailTracking
    winback_effectiveness = {}
    total_winback_sent = 0
    total_winback_recovered = 0
    try:
        winback_types = ["winback_7day", "winback_30day"]
        for wtype in winback_types:
            wb_docs = list(
                db.collection("emailTracking")
                .where("emailType", "==", wtype)
                .where("sentAt", ">=", cutoff)
                .limit(2000)
                .stream()
            )
            sent = len(wb_docs)
            recovered = sum(1 for d in wb_docs if d.to_dict().get("converted"))
            rate = round((recovered / sent * 100) if sent > 0 else 0, 1)
            winback_effectiveness[wtype] = {
                "sent": sent, "recovered": recovered, "rate": rate
            }
            total_winback_sent += sent
            total_winback_recovered += recovered
    except Exception:
        pass

    winback_rate = round(
        (total_winback_recovered / total_winback_sent * 100) if total_winback_sent > 0 else 0, 1
    )

    # Average tenure before churn
    tenures = []
    for data in churned_in_period:
        created = _get_creation_date(data)
        exp_date = _to_datetime(data.get("expirationDate"))
        if created and exp_date:
            tenures.append((exp_date - created).days)

    avg_tenure = round(sum(tenures) / len(tenures), 1) if tenures else 0

    # Churn reasons (aggregated from pre-computed reasons)
    churn_reasons = {}
    for reason in reason_by_uid.values():
        churn_reasons[reason] = churn_reasons.get(reason, 0) + 1

    # Churn rate trend: try Redis, then Firestore, then single-point fallback
    churn_rate_trend = []
    redis = _get_redis()
    if redis:
        try:
            trend_data = redis.get("analytics_cache:churn_rate_history")
            if trend_data:
                churn_rate_trend = json.loads(trend_data)
        except Exception:
            pass

    if not churn_rate_trend:
        try:
            fs_doc = db.collection("analytics_cache").document("churn_rate_history").get()
            if fs_doc.exists:
                churn_rate_trend = fs_doc.to_dict().get("history", [])
        except Exception:
            pass

    if not churn_rate_trend:
        churn_rate_trend = [{
            "date": now.strftime("%Y-%m-%d"),
            "rate": churn_rate,
            "atRiskCount": len(at_risk_users),
            "churnedCount": total_subscriber_churned,
        }]

    return {
        "churnRate": churn_rate,
        "churnRateTrend": churn_rate_trend,
        "atRiskUsers": at_risk_users,
        "churnedUsers": churned_users,
        "winbackEffectiveness": winback_effectiveness,
        "churnReasons": churn_reasons,
        "avgTenureBeforeChurn": avg_tenure,
        "atRiskCount": len(at_risk_users),
        "trialAtRiskCount": trial_at_risk_count,
        "winbackRate": winback_rate,
        "topEngagedUsers": top_engaged_users,
        "engagedCount": engaged_count,
    }


# ============================================================
# Endpoint 4: Customer Health
# ============================================================


@analytics_api_bp.route("/customer-health", methods=["GET"])
@require_analytics_auth
@safe_analytics({
    "distribution": {"healthy": 0, "atRisk": 0, "churning": 0},
    "customers": [], "averageHealthScore": 0,
})
def customer_health():
    result = _get_cached_or_compute("analytics_cache:customer_health",
                                    _compute_customer_health, ttl=900)
    return jsonify(result), 200


def _compute_customer_health() -> dict:
    from firebase_setup import db

    now = datetime.now(timezone.utc)
    users_ref = db.collection("users")

    # Paginate through active + trial users
    batch_size = 500
    last_doc = None
    customers = []
    distribution = {"healthy": 0, "atRisk": 0, "churning": 0}
    total_score = 0

    while True:
        query = (users_ref
                 .where("subscriptionStatus", "in", ["active", "trial"])
                 .order_by("__name__")
                 .limit(batch_size))
        if last_doc:
            query = query.start_after(last_doc)

        docs = list(query.stream())
        if not docs:
            break

        for doc in docs:
            data = doc.to_dict()
            health = _compute_health_score(data, now)
            created = _get_creation_date(data)
            subscribed_days = (now - created).days if created else 0

            customer = {
                "uid": doc.id,
                "email": data.get("email", ""),
                "name": data.get("displayName") or data.get("name", ""),
                "healthScore": health["healthScore"],
                "healthStatus": health["healthStatus"],
                "factors": health["factors"],
                "subscriptionStatus": data.get("subscriptionStatus", ""),
                "platform": data.get("platform", "unknown") or "unknown",
                "lastActiveAt": _safe_isoformat(data.get("lastActiveAt")),
                "subscribedDays": subscribed_days,
            }
            customers.append(customer)
            distribution[health["healthStatus"]] = distribution.get(health["healthStatus"], 0) + 1
            total_score += health["healthScore"]

        last_doc = docs[-1]
        if len(docs) < batch_size:
            break

    avg_score = round(total_score / len(customers), 1) if customers else 0

    return {
        "distribution": distribution,
        "customers": customers,
        "averageHealthScore": avg_score,
    }


# ============================================================
# Endpoint 5: Customer Detail
# ============================================================


@analytics_api_bp.route("/customer/<uid>", methods=["GET"])
@require_analytics_auth
@safe_analytics({"error": "Customer not found"})
def customer_detail(uid: str):
    result = _get_customer_detail(uid)
    if result is None:
        return jsonify({"error": "Customer not found"}), 404
    return jsonify(result), 200


def _get_customer_detail(uid: str) -> dict:
    from firebase_setup import db

    now = datetime.now(timezone.utc)

    # Get user doc
    user_doc = db.collection("users").document(uid).get()
    if not user_doc.exists:
        return None

    data = user_doc.to_dict()
    health = _compute_health_score(data, now)
    usage = data.get("usageStats", {}) or {}

    # Get email history
    email_history = []
    try:
        email_docs = list(
            db.collection("emailTracking")
            .where("userId", "==", uid)
            .order_by("sentAt")
            .limit(200)
            .stream()
        )
        for edoc in email_docs:
            edata = edoc.to_dict()
            email_history.append({
                "emailType": edata.get("emailType", ""),
                "sentAt": _safe_isoformat(edata.get("sentAt")),
                "converted": bool(edata.get("converted")),
                "opened": bool(edata.get("opened")),
                "clicked": bool(edata.get("clicked")),
            })
    except Exception:
        pass

    # Infer subscription history from user doc fields
    subscription_history = []
    created = _get_creation_date(data)
    if created:
        subscription_history.append({
            "event": "created",
            "date": created.isoformat(),
        })

    trial_end = _to_datetime(data.get("trialEndDate"))
    if trial_end:
        subscription_history.append({
            "event": "trial_started",
            "date": trial_end.isoformat(),
        })

    renewal_date = _to_datetime(data.get("renewalDate"))
    if renewal_date:
        subscription_history.append({
            "event": "subscription_active",
            "date": renewal_date.isoformat(),
        })

    expiration_date = _to_datetime(data.get("expirationDate"))
    if expiration_date:
        subscription_history.append({
            "event": "expired",
            "date": expiration_date.isoformat(),
        })

    subscription_history.sort(key=lambda x: x["date"])

    return {
        "uid": uid,
        "email": data.get("email", ""),
        "name": data.get("displayName") or data.get("name", ""),
        "subscriptionStatus": data.get("subscriptionStatus", ""),
        "platform": data.get("platform", "unknown") or "unknown",
        "createdAt": _safe_isoformat(data.get("createdAt")),
        "lastActiveAt": _safe_isoformat(data.get("lastActiveAt")),
        "healthScore": health["healthScore"],
        "usageStats": {
            "monthlySearches": usage.get("monthlySearches", 0) or 0,
            "monthlyDocuments": usage.get("monthlyDocuments", 0) or 0,
            "monthlyImages": usage.get("monthlyImages", 0) or 0,
            "monthlyNotes": usage.get("monthlyNotes", 0) or 0,
            "monthlyCollections": usage.get("monthlyCollections", 0) or 0,
        },
        "emailHistory": email_history,
        "subscriptionHistory": subscription_history,
    }


# ============================================================
# Email Stats
# ============================================================


@analytics_api_bp.route("/email-stats", methods=["GET"])
@require_analytics_auth
@safe_analytics({
    "period_days": 30,
    "generated_at": "",
    "by_email_type": {},
    "by_day": [],
    "totals": {"sent": 0, "converted": 0, "overallConversionRate": 0},
})
def get_email_stats():
    """
    Email conversion statistics for the dashboard.

    Query params:
        days: Number of days to look back (default: 30, max: 365)
    """
    days = request.args.get("days", 30, type=int)
    days = min(max(days, 1), 365)

    from email_tracking import get_conversion_stats

    stats = get_conversion_stats(days)
    return jsonify(stats), 200


# ============================================================
# Broadcasts (Resend API)
# ============================================================


@analytics_api_bp.route("/broadcasts", methods=["GET"])
@require_analytics_auth
@safe_analytics({"broadcasts": [], "totals": {"sent": 0, "draft": 0, "queued": 0}})
def get_broadcasts():
    """
    List broadcasts from Resend API with metadata.

    Fetches all broadcasts, enriches them with name/subject
    by calling the individual broadcast endpoint. Results cached 10 min.
    """
    import httpx

    resend_api_key = os.environ.get("RESEND_API_KEY", "")
    if not resend_api_key:
        return jsonify({"broadcasts": [], "error": "RESEND_API_KEY not configured"}), 200

    cache_key = "analytics_cache:broadcasts"

    # Cap detail fetches to avoid rate limits / timeouts
    MAX_DETAIL_FETCHES = 30

    def _fetch_broadcasts():
        headers = {"Authorization": f"Bearer {resend_api_key}"}

        # Fetch broadcast list
        resp = httpx.get(
            "https://api.resend.com/broadcasts",
            headers=headers,
            timeout=15.0,
        )
        resp.raise_for_status()
        body = resp.json()
        raw_broadcasts = body.get("data", [])

        # Enrich broadcasts with name/subject (requires individual GET).
        # Prioritise sent, then queued, then draft for detail fetches.
        status_priority = {"sent": 0, "queued": 1, "draft": 2}
        sorted_raw = sorted(raw_broadcasts, key=lambda x: status_priority.get(x.get("status", ""), 3))

        broadcasts = []
        detail_fetches = 0
        for b in sorted_raw:
            bid = b.get("id")
            status = b.get("status", "")
            entry = {
                "id": bid,
                "status": status,
                "created_at": b.get("created_at"),
                "scheduled_at": b.get("scheduled_at"),
                "sent_at": b.get("sent_at"),
                "segment_id": b.get("segment_id") or b.get("audience_id"),
            }

            # Fetch details to get name + subject (capped)
            if bid and detail_fetches < MAX_DETAIL_FETCHES:
                try:
                    detail_resp = httpx.get(
                        f"https://api.resend.com/broadcasts/{bid}",
                        headers=headers,
                        timeout=10.0,
                    )
                    if detail_resp.status_code == 200:
                        detail = detail_resp.json()
                        entry["name"] = detail.get("name", "")
                        entry["subject"] = detail.get("subject", "")
                        entry["from"] = detail.get("from", "")
                        entry["preview_text"] = detail.get("preview_text", "")
                    detail_fetches += 1
                except Exception as e:
                    logging.warning(f"[BROADCASTS] Failed to fetch detail for {bid}: {e}")
                    detail_fetches += 1

            broadcasts.append(entry)

        # Sort: sent first (newest), then queued, then draft
        def _sort_key(x):
            group = status_priority.get(x["status"], 3)
            # Parse date for ordering within group (newest first)
            date_str = x.get("sent_at") or x.get("created_at") or ""
            try:
                ts = datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp() if date_str else 0
            except (ValueError, AttributeError):
                ts = 0
            return (group, -ts)

        broadcasts.sort(key=_sort_key)

        sent_count = sum(1 for b in broadcasts if b["status"] == "sent")
        draft_count = sum(1 for b in broadcasts if b["status"] == "draft")
        queued_count = sum(1 for b in broadcasts if b["status"] == "queued")

        return {
            "broadcasts": broadcasts,
            "totals": {"sent": sent_count, "draft": draft_count, "queued": queued_count},
        }

    result = _get_cached_or_compute(cache_key, _fetch_broadcasts, ttl=600)
    return jsonify(result), 200


# ============================================================
# Email Templates
# ============================================================

# Template metadata (no HTML — lightweight list)
_EMAIL_TEMPLATES = {
    "trial_started": {
        "name": "Trial Started",
        "category": "Trial & Subscription",
        "description": "Sent immediately when a user starts their trial via RevenueCat webhook.",
        "trigger": "webhook",
        "schedule": "Immediate (TRIAL_STARTED event)",
    },
    "trial_ending": {
        "name": "Trial Ending",
        "category": "Trial & Subscription",
        "description": "Sent 12 hours before trial expires to encourage conversion.",
        "trigger": "beat",
        "schedule": "Every 6 hours (check_trials_ending_soon)",
    },
    "subscription_expired": {
        "name": "Subscription Expired",
        "category": "Trial & Subscription",
        "description": "Sent immediately when a subscription or trial expires.",
        "trigger": "webhook",
        "schedule": "Immediate (EXPIRATION event)",
    },
    "billing_issue": {
        "name": "Billing Issue",
        "category": "Trial & Subscription",
        "description": "Sent when a payment fails to prompt the user to update billing.",
        "trigger": "webhook",
        "schedule": "Immediate (BILLING_ISSUE event)",
    },
    "renewal_reminder": {
        "name": "Renewal Reminder",
        "category": "Trial & Subscription",
        "description": "Sent 7 days before subscription renewal date.",
        "trigger": "beat",
        "schedule": "Daily at 09:00 UTC (check_renewal_reminders)",
    },
    "day1_help_center": {
        "name": "Day 1 — Help Center",
        "category": "Welcome Sequence",
        "description": "First onboarding email introducing the Help Center, sent 24 hours after signup.",
        "trigger": "beat",
        "schedule": "Every 6 hours (check_welcome_sequence_day1)",
    },
    "day3_artifacts": {
        "name": "Day 3 — Artifacts",
        "category": "Welcome Sequence",
        "description": "Second onboarding email highlighting Artifacts feature.",
        "trigger": "beat",
        "schedule": "Twice daily at 05:00/17:00 UTC (check_welcome_sequence_day3)",
    },
    "day7_researcher_stories": {
        "name": "Day 7 — Researcher Stories",
        "category": "Welcome Sequence",
        "description": "Third onboarding email with real user stories.",
        "trigger": "beat",
        "schedule": "Daily at 11:30 UTC (check_welcome_sequence_day7)",
    },
    "monthly_recap": {
        "name": "Monthly Recap",
        "category": "Engagement",
        "description": "Monthly usage summary sent to active subscribers on the 1st.",
        "trigger": "beat",
        "schedule": "1st of month at 14:00 UTC (check_monthly_recap)",
    },
    "reengagement_14day": {
        "name": "14-Day Re-engagement",
        "category": "Engagement",
        "description": "Sent to users inactive for 14+ days to bring them back.",
        "trigger": "beat",
        "schedule": "Daily at 12:00 UTC (check_reengagement_14day)",
    },
    "signup_no_trial_nudge": {
        "name": "Signup No-Trial Nudge",
        "category": "Engagement",
        "description": "Sent 3-4 days after signup if user never started a trial.",
        "trigger": "beat",
        "schedule": "Daily at 12:30 UTC (check_signup_no_trial)",
    },
    "winback_7day": {
        "name": "7-Day Win-back",
        "category": "Win-back",
        "description": "Sent 7 days after subscription expiration with a discount offer.",
        "trigger": "beat",
        "schedule": "Daily at 10:00 UTC (check_churned_users_7day)",
    },
    "winback_30day": {
        "name": "30-Day Win-back",
        "category": "Win-back",
        "description": "Sent 30 days after expiration with 'what's new' messaging.",
        "trigger": "beat",
        "schedule": "Daily at 10:30 UTC (check_churned_users_30day)",
    },
    "feature_announcement": {
        "name": "Feature Announcement",
        "category": "Announcements",
        "description": "Manually triggered to announce new features to all users.",
        "trigger": "manual",
        "schedule": "On demand",
    },
}


def _render_email_template(key: str) -> dict | None:
    """Render a template with sample data and return subject/html/text."""
    import email_service

    renderers = {
        "trial_started": lambda: email_service.get_trial_started_email("James"),
        "trial_ending": lambda: email_service.get_trial_ending_email("James", hours_remaining=12),
        "subscription_expired": lambda: email_service.get_subscription_expired_email("James"),
        "billing_issue": lambda: email_service.get_billing_issue_email("James"),
        "renewal_reminder": lambda: email_service.get_renewal_reminder_email("James", days_until_renewal=7, amount="$9.99"),
        "day1_help_center": lambda: email_service.get_day1_help_center_email("James"),
        "day3_artifacts": lambda: email_service.get_day3_artifacts_email("James"),
        "day7_researcher_stories": lambda: email_service.get_day7_researcher_stories_email("James"),
        "monthly_recap": lambda: email_service.get_monthly_recap_email("James", searches=127, documents=23, images=8, notes=34, collections=6),
        "reengagement_14day": lambda: email_service.get_reengagement_14day_email("James"),
        "signup_no_trial_nudge": lambda: email_service.get_signup_no_trial_nudge_email("James"),
        "winback_7day": lambda: email_service.get_winback_7day_email("James"),
        "winback_30day": lambda: email_service.get_winback_30day_email("James"),
        "feature_announcement": lambda: email_service.get_feature_announcement_email(
            "James",
            feature_name="Smart Search",
            feature_description="Find anything across all your notes, documents, and conversations with AI-powered semantic search.",
            feature_emoji="🔍",
        ),
    }

    renderer = renderers.get(key)
    if not renderer:
        return None

    subject, html, text = renderer()

    # Replace unsubscribe placeholder with a safe preview link
    html = html.replace(
        "{UNSUBSCRIBE_LINK_PLACEHOLDER}",
        '<a href="#" style="color:#D9D9D9;text-decoration:none">Unsubscribe</a>'
        '<span style="color:#D9D9D9;opacity:0.3"> · </span>',
    )

    return {"subject": subject, "html": html, "text": text}


@analytics_api_bp.route("/email-templates", methods=["GET"])
@require_analytics_auth
@safe_analytics({"templates": [], "count": 0})
def list_email_templates():
    """List all available email templates with metadata (no HTML)."""
    templates = [{"id": key, **meta} for key, meta in _EMAIL_TEMPLATES.items()]
    return jsonify({"templates": templates, "count": len(templates)}), 200


@analytics_api_bp.route("/email-templates/<template_id>", methods=["GET"])
@require_analytics_auth
def get_email_template(template_id: str):
    """Get a single email template rendered with sample data."""
    meta = _EMAIL_TEMPLATES.get(template_id)
    if not meta:
        return jsonify({"error": f"Template '{template_id}' not found"}), 404

    rendered = _render_email_template(template_id)
    if not rendered:
        return jsonify({"error": f"Failed to render template '{template_id}'"}), 500

    return jsonify({"id": template_id, **meta, **rendered}), 200


@analytics_api_bp.route("/email-templates/preview/<template_id>", methods=["GET"])
@require_analytics_auth
def preview_email_template(template_id: str):
    """Get raw HTML preview of a template (for iframe rendering)."""
    rendered = _render_email_template(template_id)
    if not rendered:
        return jsonify({"error": "Template not found"}), 404

    from flask import make_response
    response = make_response(rendered["html"])
    response.headers["Content-Type"] = "text/html; charset=utf-8"
    return response


# ============================================================
# Onboarding Categories (Research Use Cases)
# ============================================================


# Display-friendly labels matching the iOS ResearchCategory enum
_CATEGORY_LABELS = {
    "academic": "Academic Research",
    "work": "Work & Business",
    "writing": "Writing & Content",
    "software": "Software & Dev",
    "market": "Market Research",
    "creative": "Creative Projects",
    "science": "Science & Data",
    "personalLearning": "Personal Learning",
    "legal": "Legal Research",
    "product": "Product Research",
    "other": "Other",
}


@analytics_api_bp.route("/onboarding-categories", methods=["GET"])
@require_analytics_auth
@safe_analytics({
    "categories": [], "totalUsersWithCategories": 0,
    "totalUsers": 0, "adoptionRate": 0,
})
def onboarding_categories():
    """
    Aggregate researchCategories from Firestore users.

    Returns category counts + percentages for charting.
    Cached 15 minutes in Redis.
    """
    cache_key = "analytics_cache:onboarding_categories"
    result = _get_cached_or_compute(cache_key, _compute_onboarding_categories, ttl=900)
    return jsonify(result), 200


def _camel_to_title(s: str) -> str:
    """Convert camelCase/snake_case to Title Case for unknown category keys."""
    import re
    # Insert space before uppercase letters (camelCase → camel Case)
    spaced = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)
    # Replace underscores with spaces
    spaced = spaced.replace("_", " ")
    return spaced.title()


def _compute_onboarding_categories() -> dict:
    from firebase_setup import db

    users_ref = db.collection("users")

    # Paginate through ALL users (not just active subscribers)
    batch_size = 500
    last_doc = None
    category_counts: dict[str, int] = {}
    total_users = 0
    users_with_categories = 0

    while True:
        query = users_ref.order_by("__name__").limit(batch_size)
        if last_doc:
            query = query.start_after(last_doc)

        docs = list(query.stream())
        if not docs:
            break

        for doc in docs:
            data = doc.to_dict()
            total_users += 1

            categories = data.get("researchCategories")
            if categories and isinstance(categories, list) and len(categories) > 0:
                users_with_categories += 1
                # Deduplicate within a single user (iOS uses Set but Firestore doesn't enforce)
                seen = set()
                for cat in categories:
                    if isinstance(cat, str) and cat not in seen:
                        seen.add(cat)
                        category_counts[cat] = category_counts.get(cat, 0) + 1

        last_doc = docs[-1]
        if len(docs) < batch_size:
            break

    # Build sorted list with labels and percentages
    categories = []
    for raw_key, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        label = _CATEGORY_LABELS.get(raw_key, _camel_to_title(raw_key))
        pct = round((count / users_with_categories * 100) if users_with_categories > 0 else 0, 1)
        categories.append({
            "key": raw_key,
            "name": label,
            "count": count,
            "percentage": pct,
        })

    adoption_rate = round(
        (users_with_categories / total_users * 100) if total_users > 0 else 0, 1
    )

    return {
        "categories": categories,
        "totalUsersWithCategories": users_with_categories,
        "totalUsers": total_users,
        "adoptionRate": adoption_rate,
    }


# ============================================================
# Health Check
# ============================================================


@analytics_api_bp.route("/health", methods=["GET"])
def analytics_health():
    """Quick health check - no auth required, no Firestore."""
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}), 200
