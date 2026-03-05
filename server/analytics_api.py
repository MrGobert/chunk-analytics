"""
Analytics API Blueprint for Chunk AI Command Center.

Isolated read-only endpoints that query Firestore to serve the
chunk-analytics dashboard. NO dependency on chat pipeline.

All endpoints wrap in try/except and return graceful empty data on error.
"""

import json
import logging
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
                return jsonify({**empty_response, "note": "Data temporarily unavailable"}), 200
        return decorated
    return decorator


# ============================================================
# Health Score Algorithm
# ============================================================


def _compute_health_score(user_data: dict, now: datetime) -> dict:
    """Compute health score from 5 weighted factors."""

    # Factor 1: Recency (30% weight) - How recently was user active?
    last_active = _to_datetime(user_data.get("lastActiveAt"))
    if last_active:
        days_since = (now - last_active).days
        recency = max(0, 100 - (days_since * 3.3))  # 0 after 30 days
    else:
        recency = 0

    # Factor 2: Tenure (25% weight) - How long subscribed?
    created = _to_datetime(user_data.get("createdAt"))
    if created:
        tenure_days = (now - created).days
        tenure = min(100, tenure_days * 0.67)  # Maxes at ~150 days
    else:
        tenure = 50  # Unknown

    # Factor 3: Usage Frequency (20% weight) - Monthly activity
    usage = user_data.get("usageStats", {}) or {}
    searches = usage.get("monthlySearches", 0) or 0
    frequency = min(100, searches * 5)  # 20+ searches/month = 100

    # Factor 4: Feature Depth (15% weight) - Uses multiple features?
    features_used = sum(1 for k in ["monthlySearches", "monthlyDocuments",
                        "monthlyImages", "monthlyNotes", "monthlyCollections"]
                       if (usage.get(k, 0) or 0) > 0)
    feature_depth = min(100, features_used * 25)  # 4+ features = 100

    # Factor 5: Email Engagement (10% weight)
    emails_sent = user_data.get("emailsSent", {}) or {}
    email_engagement = min(100, len(emails_sent) * 15)

    score = (recency * 0.30 + tenure * 0.25 + frequency * 0.20 +
             feature_depth * 0.15 + email_engagement * 0.10)

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
        created = _to_datetime(data.get("createdAt"))
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
        created = _to_datetime(data.get("createdAt"))
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
        created = _to_datetime(data.get("createdAt"))
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
    "avgTenureBeforeChurn": 0, "atRiskCount": 0, "winbackRate": 0,
})
def churn_intelligence():
    days = request.args.get("days", 90, type=int)
    days = min(max(days, 1), 365)

    cache_key = f"analytics_cache:churn_intelligence:{days}"
    result = _get_cached_or_compute(cache_key, _compute_churn_intelligence, days, ttl=900)
    return jsonify(result), 200


def _compute_churn_intelligence(days: int) -> dict:
    from firebase_setup import db

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    seven_days_ago = now - timedelta(days=7)

    users_ref = db.collection("users")

    # Active subscribers
    active_docs = list(users_ref.where("subscriptionStatus", "==", "active").limit(5000).stream())

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

    total_churned = len(churned_in_period)
    start_active = len(active_docs) + total_churned
    churn_rate = round((total_churned / start_active * 100) if start_active > 0 else 0, 1)

    # At-risk users: active but not seen in 7+ days
    at_risk_users = []
    for doc in active_docs:
        data = doc.to_dict()
        last_active = _to_datetime(data.get("lastActiveAt"))
        if last_active is None or last_active < seven_days_ago:
            days_since = (now - last_active).days if last_active else 999
            health = _compute_health_score(data, now)
            created = _to_datetime(data.get("createdAt"))
            sub_age = (now - created).days if created else 0

            at_risk_users.append({
                "uid": doc.id,
                "email": data.get("email", ""),
                "lastActive": _safe_isoformat(last_active),
                "daysSinceActive": days_since,
                "healthScore": health["healthScore"],
                "subscriptionAge": sub_age,
                "platform": data.get("platform", "unknown") or "unknown",
            })

    at_risk_users.sort(key=lambda x: x["healthScore"])

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

    churned_users = []
    for data in churned_subset:
        uid = data["_uid"]
        created = _to_datetime(data.get("createdAt"))
        exp_date = _to_datetime(data.get("expirationDate"))
        tenure = (exp_date - created).days if (exp_date and created) else 0

        user_emails = email_by_user.get(uid, {"received": [], "opened": []})
        usage = data.get("usageStats", {}) or {}
        churned_users.append({
            "uid": uid,
            "email": data.get("email", ""),
            "churnDate": _safe_isoformat(exp_date),
            "tenure": tenure,
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
        created = _to_datetime(data.get("createdAt"))
        exp_date = _to_datetime(data.get("expirationDate"))
        if created and exp_date:
            tenures.append((exp_date - created).days)

    avg_tenure = round(sum(tenures) / len(tenures), 1) if tenures else 0

    # Churn reasons (inferred from data)
    churn_reasons = {}
    for data in churned_in_period:
        usage = data.get("usageStats", {}) or {}
        searches = usage.get("monthlySearches", 0) or 0
        emails_sent = data.get("emailsSent", {}) or {}

        if searches == 0:
            reason = "No usage"
        elif searches < 5:
            reason = "Low usage"
        elif emails_sent.get("billingIssue"):
            reason = "Billing issue"
        else:
            reason = "Unknown"
        churn_reasons[reason] = churn_reasons.get(reason, 0) + 1

    return {
        "churnRate": churn_rate,
        "churnRateTrend": [],  # Requires historical snapshots (populated by daily task)
        "atRiskUsers": at_risk_users,
        "churnedUsers": churned_users,
        "winbackEffectiveness": winback_effectiveness,
        "churnReasons": churn_reasons,
        "avgTenureBeforeChurn": avg_tenure,
        "atRiskCount": len(at_risk_users),
        "winbackRate": winback_rate,
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
            created = _to_datetime(data.get("createdAt"))
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
    created = _to_datetime(data.get("createdAt"))
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
# Health Check
# ============================================================


@analytics_api_bp.route("/health", methods=["GET"])
def analytics_health():
    """Quick health check - no auth required, no Firestore."""
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}), 200
