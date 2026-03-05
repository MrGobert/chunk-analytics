"""
Email Conversion Tracking for Chunk AI

Tracks emails sent and conversions to measure campaign effectiveness.
Stores data in Firestore collection: emailTracking

Schema:
    emailTracking/{docId}:
        userId: string
        email: string
        emailType: string (winback_7day, winback_30day, trial_ending, etc.)
        sentAt: timestamp
        converted: boolean
        convertedAt: timestamp | null
        conversionEvent: string | null (INITIAL_PURCHASE, RENEWAL, TRIAL_CONVERTED)
        daysToConvert: int | null

Stats are cached in Redis for fast retrieval:
    email_stats:{days} - JSON blob of stats, refreshed every 5 minutes
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from firebase_setup import db

logging.basicConfig(level=logging.INFO)

# Email types that can lead to conversions
TRACKABLE_EMAIL_TYPES = [
    "winback_7day",
    "winback_30day",
    "trial_ending",
    "billing_issue",
    "subscription_expired",
    "trial_started",
    "reengagement_14day",
    "signup_no_trial_nudge",
    "feature_announcement",
    "renewal_reminder",
    "monthly_recap",
    "day1_superpowers",
    "day3_collections",
    "day7_researcher_stories",
]

# Conversion window: how many days after email can a conversion be attributed
CONVERSION_WINDOW_DAYS = 30

# Cache TTL for stats (5 minutes)
STATS_CACHE_TTL_SECONDS = 300


def _get_redis():
    """Get Redis client, return None if unavailable."""
    try:
        from redis_setup import redis_client

        if redis_client and redis_client.ping():
            return redis_client
    except Exception as e:
        logging.warning(f"[EMAIL_TRACKING] Redis unavailable: {e}")
    return None


def track_email_sent(user_id: str, email: str, email_type: str, resend_email_id: str = None) -> Optional[str]:
    """
    Track an email being sent for conversion attribution.

    Args:
        user_id: Firebase user ID
        email: User's email address
        email_type: Type of email (e.g., 'winback_7day', 'trial_ending')
        resend_email_id: Resend email ID for webhook event tracking

    Returns:
        Document ID of the tracking record, or None if failed
    """
    try:
        doc_ref = db.collection("emailTracking").document()
        doc_data = {
            "userId": user_id,
            "email": email,
            "emailType": email_type,
            "sentAt": datetime.now(timezone.utc),
            "converted": False,
            "convertedAt": None,
            "conversionEvent": None,
            "daysToConvert": None,
            # New fields for email event tracking
            "delivered": False,
            "opened": False,
            "openedAt": None,
            "clicked": False,
            "clickedAt": None,
            "bounced": False,
            "bouncedAt": None,
        }
        
        # Add resend_email_id if provided
        if resend_email_id:
            doc_data["resendEmailId"] = resend_email_id
            
        doc_ref.set(doc_data)

        logging.info(f"[EMAIL_TRACKING] Tracked {email_type} email for user {user_id}")

        # Invalidate cache since new email was sent
        _invalidate_stats_cache()

        return doc_ref.id

    except Exception as e:
        logging.error(f"[EMAIL_TRACKING] Failed to track email: {e}")
        return None


def _invalidate_stats_cache():
    """Invalidate all cached stats."""
    redis_client = _get_redis()
    if redis_client:
        try:
            # Delete all email_stats keys
            keys = redis_client.keys("email_stats:*")
            if keys:
                redis_client.delete(*keys)
                logging.info(f"[EMAIL_TRACKING] Invalidated {len(keys)} cached stats")
        except Exception as e:
            logging.warning(f"[EMAIL_TRACKING] Failed to invalidate cache: {e}")


def check_and_mark_conversion(
    user_id: str, conversion_event: str
) -> List[Dict[str, Any]]:
    """
    Check if user received trackable emails and mark them as converted.

    Called when a conversion event occurs (INITIAL_PURCHASE, RENEWAL, TRIAL_CONVERTED).

    Args:
        user_id: Firebase user ID
        conversion_event: Type of conversion (e.g., 'INITIAL_PURCHASE')

    Returns:
        List of email records that were marked as converted
    """
    converted_emails = []

    try:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=CONVERSION_WINDOW_DAYS)

        # Query for unconverted emails sent to this user within the conversion window
        query = (
            db.collection("emailTracking")
            .where("userId", "==", user_id)
            .where("converted", "==", False)
            .where("sentAt", ">=", cutoff)
        )

        docs = query.stream()

        for doc in docs:
            data = doc.to_dict()
            sent_at = data.get("sentAt")

            # Calculate days to convert
            if hasattr(sent_at, "timestamp"):
                sent_at_dt = datetime.fromtimestamp(
                    sent_at.timestamp(), tz=timezone.utc
                )
            else:
                sent_at_dt = sent_at

            days_to_convert = (now - sent_at_dt).days

            # Mark as converted
            doc.reference.update(
                {
                    "converted": True,
                    "convertedAt": now,
                    "conversionEvent": conversion_event,
                    "daysToConvert": days_to_convert,
                }
            )

            converted_emails.append(
                {
                    "id": doc.id,
                    "emailType": data.get("emailType"),
                    "daysToConvert": days_to_convert,
                }
            )

            logging.info(
                f"[EMAIL_TRACKING] Marked conversion: {data.get('emailType')} → {conversion_event} ({days_to_convert} days)"
            )

        if converted_emails:
            logging.info(
                f"[EMAIL_TRACKING] User {user_id} converted from {len(converted_emails)} tracked email(s)"
            )
            # Invalidate cache since conversions changed
            _invalidate_stats_cache()

        return converted_emails

    except Exception as e:
        logging.error(f"[EMAIL_TRACKING] Failed to check conversions: {e}")
        return []


def update_email_event(resend_email_id: str, event_type: str, event_data: dict) -> bool:
    """
    Update email tracking record with delivery/open/click/bounce event.

    Args:
        resend_email_id: Resend email ID to find the tracking record
        event_type: Type of event ('delivered', 'opened', 'clicked', 'bounced', 'complained')
        event_data: Event data from Resend webhook

    Returns:
        True if update was successful, False otherwise
    """
    try:
        # Find the email tracking document by resend_email_id
        query = db.collection("emailTracking").where("resendEmailId", "==", resend_email_id).limit(1)
        docs = list(query.stream())
        
        if not docs:
            logging.warning(f"[EMAIL_TRACKING] No tracking record found for resend_email_id: {resend_email_id}")
            return False
            
        doc = docs[0]
        now = datetime.now(timezone.utc)
        update_data = {}
        
        if event_type == "delivered":
            update_data.update({"delivered": True})
        elif event_type == "opened":
            update_data.update({"opened": True, "openedAt": now})
        elif event_type == "clicked":
            update_data.update({"clicked": True, "clickedAt": now})
        elif event_type in ("bounced", "complained"):
            update_data.update({"bounced": True, "bouncedAt": now})
        else:
            logging.warning(f"[EMAIL_TRACKING] Unknown event type: {event_type}")
            return False
            
        # Update the document
        doc.reference.update(update_data)
        logging.info(f"[EMAIL_TRACKING] Updated {event_type} for email {resend_email_id}")
        
        # Invalidate cache since events changed
        _invalidate_stats_cache()
        
        return True
        
    except Exception as e:
        logging.error(f"[EMAIL_TRACKING] Failed to update email event: {e}")
        return False


def check_unsubscribed(email: str) -> bool:
    """
    Check if an email address is in the unsubscribe list.

    Args:
        email: Email address to check

    Returns:
        True if email is unsubscribed, False otherwise
    """
    try:
        doc_ref = db.collection("emailUnsubscribes").document(email)
        doc = doc_ref.get()
        return doc.exists
        
    except Exception as e:
        logging.error(f"[EMAIL_TRACKING] Failed to check unsubscribe status for {email}: {e}")
        return False


def mark_unsubscribed(email: str) -> bool:
    """
    Add an email address to the unsubscribe list.

    Args:
        email: Email address to unsubscribe

    Returns:
        True if successful, False otherwise
    """
    try:
        doc_ref = db.collection("emailUnsubscribes").document(email)
        doc_ref.set({
            "email": email,
            "unsubscribedAt": datetime.now(timezone.utc),
            "source": "manual"  # Could be 'webhook', 'complaint', etc.
        })
        
        logging.info(f"[EMAIL_TRACKING] Marked {email} as unsubscribed")
        return True
        
    except Exception as e:
        logging.error(f"[EMAIL_TRACKING] Failed to mark {email} as unsubscribed: {e}")
        return False


def get_conversion_stats(days: int = 30) -> Dict[str, Any]:
    """
    Get email conversion statistics for the specified time period.

    Uses cached data when available (refreshed every 5 minutes).
    If cache miss, triggers async refresh and returns empty stats.

    Args:
        days: Number of days to look back

    Returns:
        Dictionary with conversion stats by email type
    """
    cache_key = f"email_stats:{days}"

    # Try to get from cache first
    redis_client = _get_redis()
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                stats = json.loads(cached)
                logging.info(f"[EMAIL_TRACKING] Returning cached stats for {days} days")
                return stats
        except Exception as e:
            logging.warning(f"[EMAIL_TRACKING] Cache read failed: {e}")

    # Cache miss - try to compute stats directly with a fast query
    # Use a smaller limit and timeout-friendly approach
    try:
        stats = _compute_stats_fast(days)

        # Cache the result if Redis available
        if redis_client and stats.get("by_email_type") is not None:
            try:
                redis_client.setex(
                    cache_key, STATS_CACHE_TTL_SECONDS, json.dumps(stats)
                )
                logging.info(f"[EMAIL_TRACKING] Cached stats for {days} days")
            except Exception as e:
                logging.warning(f"[EMAIL_TRACKING] Cache write failed: {e}")

        return stats

    except Exception as e:
        logging.error(f"[EMAIL_TRACKING] Failed to compute stats: {e}")
        return {
            "period_days": days,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "by_email_type": {},
            "totals": {"sent": 0, "converted": 0, "overallConversionRate": 0},
            "error": str(e),
        }


def _compute_stats_fast(days: int) -> Dict[str, Any]:
    """
    Compute email stats with a fast, streaming approach.

    Processes documents one at a time without materializing the full list,
    which allows for early exit and better memory usage.
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    # Quick check if collection has any documents
    quick_check = db.collection("emailTracking").limit(1).get()
    if not quick_check:
        logging.info("[EMAIL_TRACKING] No email tracking documents exist yet")
        return {
            "period_days": days,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "by_email_type": {},
            "totals": {"sent": 0, "converted": 0, "overallConversionRate": 0},
            "note": "No emails have been sent yet",
        }

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Query with reasonable limit, only fetch fields we need for aggregation
    query = (
        db.collection("emailTracking")
        .where(filter=FieldFilter("sentAt", ">=", cutoff))
        .select([
            "emailType", "sentAt", "converted", "daysToConvert",
            "delivered", "opened", "clicked", "bounced",
        ])
        .limit(2000)
    )  # Process up to 2000 documents

    stats = {}
    daily_counts = {}  # date_str -> {"sent": N, "converted": N, by_type: {type: N}}
    doc_count = 0

    # Stream and process one at a time (more memory efficient)
    for doc in query.stream():
        doc_count += 1
        data = doc.to_dict()
        if not data:
            continue

        email_type = data.get("emailType", "unknown")

        if email_type not in stats:
            stats[email_type] = {
                "sent": 0,
                "converted": 0,
                "conversionRate": 0,
                "avgDaysToConvert": 0,
                "totalDaysToConvert": 0,
                "delivered": 0,
                "opened": 0,
                "clicked": 0,
                "bounced": 0,
            }

        stats[email_type]["sent"] += 1

        # Track daily time-series
        sent_at = data.get("sentAt")
        if sent_at:
            if hasattr(sent_at, "strftime"):
                day_key = sent_at.strftime("%Y-%m-%d")
            elif hasattr(sent_at, "timestamp"):
                day_key = datetime.fromtimestamp(sent_at.timestamp(), tz=timezone.utc).strftime("%Y-%m-%d")
            else:
                day_key = None

            if day_key:
                if day_key not in daily_counts:
                    daily_counts[day_key] = {"sent": 0, "converted": 0, "by_type": {}}
                daily_counts[day_key]["sent"] += 1
                daily_counts[day_key]["by_type"][email_type] = daily_counts[day_key]["by_type"].get(email_type, 0) + 1
                if data.get("converted"):
                    daily_counts[day_key]["converted"] += 1

        if data.get("converted"):
            stats[email_type]["converted"] += 1
            days_to_convert = data.get("daysToConvert", 0) or 0
            stats[email_type]["totalDaysToConvert"] += days_to_convert
            
        # Count delivery/engagement events
        if data.get("delivered"):
            stats[email_type]["delivered"] += 1
        if data.get("opened"):
            stats[email_type]["opened"] += 1
        if data.get("clicked"):
            stats[email_type]["clicked"] += 1
        if data.get("bounced"):
            stats[email_type]["bounced"] += 1

    logging.info(
        f"[EMAIL_TRACKING] Processed {doc_count} email records in last {days} days"
    )

    # Calculate rates and averages
    for email_type, type_data in stats.items():
        if type_data["sent"] > 0:
            type_data["conversionRate"] = round(
                type_data["converted"] / type_data["sent"] * 100, 1
            )
        if type_data["converted"] > 0:
            type_data["avgDaysToConvert"] = round(
                type_data["totalDaysToConvert"] / type_data["converted"], 1
            )
        del type_data["totalDaysToConvert"]  # Remove helper field

    total_sent = sum(s["sent"] for s in stats.values()) if stats else 0
    total_converted = sum(s["converted"] for s in stats.values()) if stats else 0

    # Build sorted daily time-series (fill in missing days with zeros)
    by_day = []
    if daily_counts:
        start_date = cutoff.date()
        end_date = datetime.now(timezone.utc).date()
        current = start_date
        while current <= end_date:
            day_str = current.isoformat()
            day_data = daily_counts.get(day_str, {"sent": 0, "converted": 0, "by_type": {}})
            by_day.append({
                "date": day_str,
                "sent": day_data["sent"],
                "converted": day_data["converted"],
                "by_type": day_data.get("by_type", {}),
            })
            current += timedelta(days=1)

    return {
        "period_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "by_email_type": stats,
        "by_day": by_day,
        "totals": {
            "sent": total_sent,
            "converted": total_converted,
            "overallConversionRate": (
                round(total_converted / max(1, total_sent) * 100, 1) if stats else 0
            ),
        },
    }


def refresh_stats_cache(days_list: List[int] = None):
    """
    Refresh the stats cache for specified day ranges.

    Called by Celery task to keep cache warm.

    Args:
        days_list: List of day ranges to refresh (default: [7, 30, 90])
    """
    if days_list is None:
        days_list = [7, 30, 90]

    redis_client = _get_redis()
    if not redis_client:
        logging.warning("[EMAIL_TRACKING] Cannot refresh cache - Redis unavailable")
        return

    for days in days_list:
        try:
            stats = _compute_stats_fast(days)
            cache_key = f"email_stats:{days}"

            redis_client.setex(
                cache_key,
                STATS_CACHE_TTL_SECONDS * 2,  # Longer TTL for background refresh
                json.dumps(stats),
            )
            logging.info(
                f"[EMAIL_TRACKING] Refreshed cache for {days} days: {stats.get('totals', {})}"
            )

        except Exception as e:
            logging.error(
                f"[EMAIL_TRACKING] Failed to refresh cache for {days} days: {e}"
            )


def get_user_email_history(user_id: str) -> List[Dict[str, Any]]:
    """
    Get all tracked emails for a specific user.

    Args:
        user_id: Firebase user ID

    Returns:
        List of email records
    """
    try:
        query = (
            db.collection("emailTracking")
            .where("userId", "==", user_id)
            .order_by("sentAt", direction="DESCENDING")
            .limit(100)
        )  # Limit to last 100 emails

        docs = query.stream()

        results = []
        for doc in docs:
            data = doc.to_dict()
            # Convert Firestore timestamps to ISO strings for JSON serialization
            if "sentAt" in data and hasattr(data["sentAt"], "isoformat"):
                data["sentAt"] = data["sentAt"].isoformat()
            if (
                "convertedAt" in data
                and data["convertedAt"]
                and hasattr(data["convertedAt"], "isoformat")
            ):
                data["convertedAt"] = data["convertedAt"].isoformat()
            results.append({"id": doc.id, **data})

        return results

    except Exception as e:
        logging.error(f"[EMAIL_TRACKING] Failed to get user history: {e}")
        return []
