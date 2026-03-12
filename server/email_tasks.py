"""
Celery Email Tasks for Chunk AI
Scheduled and delayed email sending via Celery workers.

Environment Variables Required:
- REDIS_URL: Redis connection URL (for Celery broker/backend)
- RESEND_API_KEY: Resend API key for sending emails

Usage:
1. Immediate send: send_trial_ending_task.delay(email, name, hours_remaining)
2. Scheduled send: send_trial_ending_task.apply_async(args=[...], eta=datetime)
3. Beat schedule: Configured in celery_config.py

Note: Tasks use email_service.py functions internally.
"""

import logging
import re
from datetime import datetime, timedelta, timezone

from celery import shared_task

import email_service
from email_tracking import check_unsubscribed, track_email_sent

logging.basicConfig(level=logging.INFO)

# Marketing email types that should not overlap within 24 hours.
# Transactional emails (billing_issue, subscription_expired) are excluded —
# those should always send immediately regardless of recent marketing emails.
MARKETING_EMAIL_FLAGS = [
    "winback7Day",
    "winback30Day",
    "reengagement14Day",
    "signupNoTrialNudge",
    "welcomeDay1",
    "welcomeDay3",
    "welcomeDay7",
    "monthlyRecap",
    "renewalReminder",
    "trialEnding",
]

# Minimum hours between marketing emails to the same user
EMAIL_COOLDOWN_HOURS = 24


def _received_recent_email(emails_sent: dict, cooldown_hours: int = EMAIL_COOLDOWN_HOURS) -> bool:
    """
    Check if the user received any marketing email within the cooldown window.

    Args:
        emails_sent: The user's emailsSent dict from Firestore
        cooldown_hours: Minimum hours since last marketing email

    Returns:
        True if a marketing email was sent recently (should skip), False if safe to send
    """
    if not emails_sent:
        return False

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=cooldown_hours)

    for flag in MARKETING_EMAIL_FLAGS:
        sent_at = emails_sent.get(flag)
        if sent_at is None:
            continue

        # Firestore timestamps may be datetime objects or have .timestamp()
        try:
            if isinstance(sent_at, datetime):
                if sent_at.tzinfo is None:
                    sent_at = sent_at.replace(tzinfo=timezone.utc)
                if sent_at > cutoff:
                    return True
            elif hasattr(sent_at, "timestamp"):
                sent_dt = datetime.fromtimestamp(sent_at.timestamp(), tz=timezone.utc)
                if sent_dt > cutoff:
                    return True
        except Exception:
            # If we can't parse the timestamp, skip this flag
            continue

    return False


def is_valid_email(email: str) -> bool:
    """Basic email validation."""
    if not email:
        return False
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return bool(re.match(pattern, email))


def _is_test_email(email: str) -> bool:
    """Check if email is a test/internal domain that should be skipped."""
    if not email:
        return True
    domain = email.split("@")[-1].lower()
    return domain.endswith(".test.com") or domain in ("test.com", "example.com")


def _is_stale_account(user_data: dict, max_age_months: int = 12) -> bool:
    """Check if account is older than max_age_months. Stale accounts should
    be excluded from winback/re-engagement emails (they're not coming back)."""
    created = user_data.get("createdAt")
    if not created:
        return False  # Unknown age — don't skip
    now = datetime.now(timezone.utc)
    if hasattr(created, "timestamp"):
        created = datetime.fromtimestamp(created.timestamp(), tz=timezone.utc)
    elif isinstance(created, datetime):
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
    else:
        return False
    return (now - created).days > (max_age_months * 30)


def _should_skip_user(user_data: dict, check_stale: bool = False) -> bool:
    """Common pre-send checks for beat tasks. Returns True if user should be skipped."""
    email = user_data.get("email")
    if not email or not is_valid_email(email):
        return True
    if _is_test_email(email):
        return True
    if check_stale and _is_stale_account(user_data):
        return True
    return False


# ============================================================
# Email Tasks - Triggered by Webhooks
# ============================================================


@shared_task(
    bind=True,
    name="send_trial_ending_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_trial_ending_task(
    self,
    email: str,
    user_name: str = "there",
    hours_remaining: int = 12,
    user_id: str = None,
):
    """
    Send trial ending email.

    Called via apply_async() with eta parameter for scheduled sending.

    Example:
        # Schedule for 12 hours before trial ends
        trial_end = datetime.now(timezone.utc) + timedelta(days=3)
        send_time = trial_end - timedelta(hours=12)
        send_trial_ending_task.apply_async(
            args=[email, user_name, 12, user_id],
            eta=send_time
        )
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping trial ending: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending trial ending email to {email}")

        result = email_service.send_trial_ending(email, user_name, hours_remaining, user_id)
        resend_email_id = result.get("id")

        # Track for conversion attribution
        if user_id:
            track_email_sent(user_id, email, "trial_ending", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Trial ending email sent to {email}")
        return {"status": "sent", "email": email, "type": "trial_ending"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send trial ending email to {email}: {e}"
        )
        raise  # Re-raise to trigger Celery retry if configured


@shared_task(
    bind=True,
    name="send_winback_7day_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_winback_7day_task(
    self, email: str, user_name: str = "there", user_id: str = None
):
    """
    Send 7-day winback email with discount offer.

    Called 7 days after subscription expiration.

    Example:
        expiry_date = datetime.now(timezone.utc)
        send_winback_7day_task.apply_async(
            args=[email, user_name, user_id],
            eta=expiry_date + timedelta(days=7)
        )
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping 7-day winback: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending 7-day winback email to {email}")

        result = email_service.send_winback_7day(email, user_name, user_id)
        resend_email_id = result.get("id")

        # Track for conversion attribution
        if user_id:
            track_email_sent(user_id, email, "winback_7day", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ 7-day winback email sent to {email}")
        return {"status": "sent", "email": email, "type": "winback_7day"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send 7-day winback email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="send_winback_30day_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_winback_30day_task(
    self, email: str, user_name: str = "there", user_id: str = None
):
    """
    Send 30-day winback email ("What's new" update).

    Called 30 days after subscription expiration.
    Uses dedicated get_winback_30day_email() template with "what's new" messaging.

    Example:
        expiry_date = datetime.now(timezone.utc)
        send_winback_30day_task.apply_async(
            args=[email, user_name, user_id],
            eta=expiry_date + timedelta(days=30)
        )
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping 30-day winback: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending 30-day winback email to {email}")

        result = email_service.send_winback_30day(email, user_name, user_id)
        resend_email_id = result.get("id")

        # Track for conversion attribution
        if user_id:
            track_email_sent(user_id, email, "winback_30day", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ 30-day winback email sent to {email}")
        return {"status": "sent", "email": email, "type": "winback_30day"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send 30-day winback email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="send_monthly_recap_email",
    ignore_result=True,
    soft_time_limit=60,
    time_limit=90,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_monthly_recap_task(
    self,
    email: str,
    user_name: str = "there",
    searches: int = 0,
    documents: int = 0,
    images: int = 0,
    user_id: str = None,
    notes: int = 0,
    collections: int = 0,
):
    """
    Send monthly usage recap email to active subscriber.

    Example:
        send_monthly_recap_task.delay(email, user_name, searches=42, documents=5, images=12, user_id="uid", notes=10, collections=3)
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping monthly recap: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending monthly recap email to {email}")

        result = email_service.send_monthly_recap(
            email, user_name, searches, documents, images, user_id,
            notes, collections,
        )
        resend_email_id = result.get("id")

        # Track for analytics
        if user_id:
            track_email_sent(user_id, email, "monthly_recap", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Monthly recap email sent to {email}")
        return {"status": "sent", "email": email, "type": "monthly_recap"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send monthly recap email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="send_subscription_expired_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_subscription_expired_task(
    self, email: str, user_name: str = "there", user_id: str = None
):
    """
    Send subscription expired email.

    Called immediately when subscription expires.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping subscription expired: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending subscription expired email to {email}")

        result = email_service.send_subscription_expired(email, user_name, user_id)
        resend_email_id = result.get("id")

        # Track for conversion attribution
        if user_id:
            track_email_sent(user_id, email, "subscription_expired", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Subscription expired email sent to {email}")
        return {"status": "sent", "email": email, "type": "subscription_expired"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send subscription expired email to {email}: {e}"
        )
        raise


# ============================================================
# Beat Tasks - Run on Schedule
# ============================================================


@shared_task(
    bind=True,
    name="check_trials_ending_soon",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_trials_ending_soon_task(self):
    """
    Daily task: Find users whose trials end in next 12 hours and send reminder.

    Queries Firestore for users with:
    - Active trial
    - Trial end time within next 12 hours
    - Haven't received trial ending email yet

    Schedule: Run every 6 hours via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for trials ending in next 12 hours...")

        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(hours=12)

        # Query users collection for active trials ending soon
        users_ref = db.collection("users")
        query = (
            users_ref.where("subscriptionStatus", "==", "trial")
            .where("trialEndDate", "<=", cutoff)
            .where("trialEndDate", ">", now)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))
            trial_end = user_data.get("trialEndDate")

            # Check if we already sent trial ending email
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("trialEnding"):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - trial ending email already sent"
                )
                continue

            if email and trial_end:
                # Calculate hours remaining
                if hasattr(trial_end, "timestamp"):
                    trial_end_dt = datetime.fromtimestamp(
                        trial_end.timestamp(), tz=timezone.utc
                    )
                else:
                    trial_end_dt = trial_end

                hours_remaining = max(
                    1, int((trial_end_dt - now).total_seconds() / 3600)
                )

                # Send email with user_id for conversion tracking
                send_trial_ending_task.delay(email, name, hours_remaining, doc.id)

                # Mark as sent
                doc.reference.update({"emailsSent.trialEnding": now})

                count += 1
                logging.info(
                    f"[BEAT_TASK] Queued trial ending email for {email} ({hours_remaining}h remaining)"
                )

        logging.info(f"[BEAT_TASK] ✓ Queued {count} trial ending emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking trials ending soon: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


@shared_task(
    bind=True,
    name="check_churned_users_7day",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_churned_users_7day_task(self):
    """
    Daily task: Find users who churned exactly 7 days ago and send winback email.

    Queries Firestore for users with:
    - Expired/cancelled subscription
    - Expiration date ~7 days ago
    - Haven't received 7-day winback email yet

    Schedule: Run daily via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for users who churned 7 days ago...")

        now = datetime.now(timezone.utc)
        # Window: users who churned 6.5 to 7.5 days ago
        window_start = now - timedelta(days=7, hours=12)
        window_end = now - timedelta(days=6, hours=12)

        # Query users collection for churned users
        users_ref = db.collection("users")
        query = (
            users_ref.where("subscriptionStatus", "in", ["expired", "cancelled"])
            .where("expirationDate", ">=", window_start)
            .where("expirationDate", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data, check_stale=True):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent 7-day winback email
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("winback7Day"):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - 7-day winback already sent"
                )
                continue

            # Cooldown: skip if user received any marketing email in last 24h
            if _received_recent_email(emails_sent):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - received another email recently (cooldown)"
                )
                continue

            if email:
                # Send email with user_id for conversion tracking
                send_winback_7day_task.delay(email, name, doc.id)

                # Mark as sent
                doc.reference.update({"emailsSent.winback7Day": now})

                count += 1
                logging.info(f"[BEAT_TASK] Queued 7-day winback email for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} 7-day winback emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking churned users: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


@shared_task(
    bind=True,
    name="check_churned_users_30day",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_churned_users_30day_task(self):
    """
    Daily task: Find users who churned exactly 30 days ago and send winback email.

    Schedule: Run daily via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for users who churned 30 days ago...")

        now = datetime.now(timezone.utc)
        # Window: users who churned 29.5 to 30.5 days ago
        window_start = now - timedelta(days=30, hours=12)
        window_end = now - timedelta(days=29, hours=12)

        users_ref = db.collection("users")
        query = (
            users_ref.where("subscriptionStatus", "in", ["expired", "cancelled"])
            .where("expirationDate", ">=", window_start)
            .where("expirationDate", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data, check_stale=True):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent 30-day winback email
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("winback30Day"):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - 30-day winback already sent"
                )
                continue

            # Cooldown: skip if user received any marketing email in last 24h
            if _received_recent_email(emails_sent):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - received another email recently (cooldown)"
                )
                continue

            if email:
                # Send email with user_id for conversion tracking
                send_winback_30day_task.delay(email, name, doc.id)

                doc.reference.update({"emailsSent.winback30Day": now})

                count += 1
                logging.info(f"[BEAT_TASK] Queued 30-day winback email for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} 30-day winback emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking 30-day churned users: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


# ============================================================
# Welcome Sequence Tasks - Onboarding Drip
# ============================================================


@shared_task(
    bind=True,
    name="send_day1_superpowers_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_day1_superpowers_task(self, email: str, user_name: str = "there", user_id: str = None):
    """
    Send Day 1 welcome email: 3 AI Superpowers.

    Called 24 hours after signup.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping Day 1: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending Day 1 superpowers email to {email}")

        result = email_service.send_day1_superpowers(email, user_name, user_id)
        resend_email_id = result.get("id")

        # Track for analytics
        if user_id:
            track_email_sent(user_id, email, "day1_superpowers", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Day 1 superpowers email sent to {email}")
        return {"status": "sent", "email": email, "type": "day1_superpowers"}

    except Exception as e:
        logging.error(f"[EMAIL_TASK] ❌ Failed to send Day 1 email to {email}: {e}")
        raise


@shared_task(
    bind=True,
    name="send_day3_collections_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_day3_collections_task(self, email: str, user_name: str = "there", user_id: str = None):
    """
    Send Day 3 welcome email: Collections feature highlight.

    Called 72 hours after signup.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping Day 3: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending Day 3 collections email to {email}")

        result = email_service.send_day3_collections(email, user_name, user_id)
        resend_email_id = result.get("id")

        # Track for analytics
        if user_id:
            track_email_sent(user_id, email, "day3_collections", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Day 3 collections email sent to {email}")
        return {"status": "sent", "email": email, "type": "day3_collections"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send Day 3 collections email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="send_day7_researcher_stories_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_day7_researcher_stories_task(self, email: str, user_name: str = "there", user_id: str = None):
    """
    Send Day 7 welcome email: How researchers use Chunk.

    Called 7 days after signup.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping Day 7: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending Day 7 researcher stories email to {email}")

        result = email_service.send_day7_researcher_stories(email, user_name, user_id)
        resend_email_id = result.get("id")

        # Track for analytics
        if user_id:
            track_email_sent(user_id, email, "day7_researcher_stories", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Day 7 researcher stories email sent to {email}")
        return {"status": "sent", "email": email, "type": "day7_researcher_stories"}

    except Exception as e:
        logging.error(f"[EMAIL_TASK] ❌ Failed to send Day 7 email to {email}: {e}")
        raise


@shared_task(
    bind=True,
    name="send_billing_issue_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_billing_issue_task(
    self, email: str, user_name: str = "there", user_id: str = None
):
    """
    Send billing issue notification email.

    Called immediately when RevenueCat reports a billing issue.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping billing issue: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending billing issue email to {email}")

        result = email_service.send_billing_issue(email, user_name, user_id)
        resend_email_id = result.get("id")

        # Track for conversion attribution
        if user_id:
            track_email_sent(user_id, email, "billing_issue", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Billing issue email sent to {email}")
        return {"status": "sent", "email": email, "type": "billing_issue"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send billing issue email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="send_reengagement_14day_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_reengagement_14day_task(
    self, email: str, user_name: str = "there", user_id: str = None
):
    """
    Send 14-day re-engagement email to inactive users.

    Called when a user hasn't been active for 14 days.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping 14-day re-engagement: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending 14-day re-engagement email to {email}")

        result = email_service.send_reengagement_14day(email, user_name, user_id)
        resend_email_id = result.get("id")

        if user_id:
            track_email_sent(user_id, email, "reengagement_14day", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ 14-day re-engagement email sent to {email}")
        return {"status": "sent", "email": email, "type": "reengagement_14day"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send 14-day re-engagement email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="send_feature_announcement_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_feature_announcement_task(
    self,
    email: str,
    user_name: str = "there",
    feature_name: str = "",
    feature_description: str = "",
    feature_emoji: str = "🆕",
    user_id: str = None,
):
    """
    Send feature announcement email.

    Called when a new feature is released and users should be notified.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping feature announcement: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending feature announcement email to {email}")

        result = email_service.send_feature_announcement(
            email, user_name, feature_name, feature_description, feature_emoji, user_id
        )
        resend_email_id = result.get("id")

        if user_id:
            track_email_sent(user_id, email, "feature_announcement", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Feature announcement email sent to {email}")
        return {"status": "sent", "email": email, "type": "feature_announcement"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send feature announcement email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="send_signup_no_trial_nudge_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_signup_no_trial_nudge_task(
    self, email: str, user_name: str = "there", user_id: str = None
):
    """
    Send nudge email to users who signed up but never started a trial.

    Called 3-4 days after signup if user has no trial history.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping no-trial nudge: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending signup no-trial nudge email to {email}")

        result = email_service.send_signup_no_trial_nudge(email, user_name, user_id)
        resend_email_id = result.get("id")

        if user_id:
            track_email_sent(user_id, email, "signup_no_trial_nudge", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Signup no-trial nudge email sent to {email}")
        return {"status": "sent", "email": email, "type": "signup_no_trial_nudge"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send signup no-trial nudge email to {email}: {e}"
        )
        raise


# ============================================================
# Welcome Sequence Beat Tasks - Check for users needing emails
# ============================================================


@shared_task(
    bind=True,
    name="check_welcome_sequence_day1",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_welcome_sequence_day1_task(self):
    """
    Daily task: Find users who signed up ~24 hours ago and send Day 1 email.

    Schedule: Run every 6 hours via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for users needing Day 1 email...")

        now = datetime.now(timezone.utc)
        # Window: users who signed up 20-28 hours ago
        window_start = now - timedelta(hours=28)
        window_end = now - timedelta(hours=20)

        users_ref = db.collection("users")
        query = (
            users_ref.where("createdAt", ">=", window_start)
            .where("createdAt", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent Day 1 email
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("welcomeDay1"):
                continue

            # Cooldown: skip if user received any marketing email in last 24h
            if _received_recent_email(emails_sent):
                continue

            if email:
                send_day1_superpowers_task.delay(email, name, doc.id)

                doc.reference.update({"emailsSent.welcomeDay1": now})

                count += 1
                logging.info(f"[BEAT_TASK] Queued Day 1 email for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} Day 1 welcome emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking Day 1 users: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


@shared_task(
    bind=True,
    name="check_welcome_sequence_day3",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_welcome_sequence_day3_task(self):
    """
    Daily task: Find users who signed up ~3 days ago and send Day 3 email.

    Schedule: Run daily via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info(
            "[BEAT_TASK] Checking for users needing Day 3 collections email..."
        )

        now = datetime.now(timezone.utc)
        # Window: 24-hour window centered on 72h (3 days) after signup
        # Using timedelta(days=3, hours=12) to timedelta(days=2, hours=12)
        # matches Day 7's approach and ensures all signups are caught
        window_start = now - timedelta(days=3, hours=12)
        window_end = now - timedelta(days=2, hours=12)

        users_ref = db.collection("users")
        query = (
            users_ref.where("createdAt", ">=", window_start)
            .where("createdAt", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent Day 3 email
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("welcomeDay3"):
                continue

            # Cooldown: skip if user received any marketing email in last 24h
            if _received_recent_email(emails_sent):
                continue

            if email:
                send_day3_collections_task.delay(email, name, doc.id)

                doc.reference.update({"emailsSent.welcomeDay3": now})

                count += 1
                logging.info(f"[BEAT_TASK] Queued Day 3 collections email for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} Day 3 collections emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking Day 3 collections users: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


@shared_task(
    bind=True,
    name="check_welcome_sequence_day7",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_welcome_sequence_day7_task(self):
    """
    Daily task: Find users who signed up ~7 days ago and send Day 7 email.

    Schedule: Run daily via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for users needing Day 7 email...")

        now = datetime.now(timezone.utc)
        # Window: users who signed up 6.5-7.5 days ago
        window_start = now - timedelta(days=7, hours=12)
        window_end = now - timedelta(days=6, hours=12)

        users_ref = db.collection("users")
        query = (
            users_ref.where("createdAt", ">=", window_start)
            .where("createdAt", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent Day 7 email
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("welcomeDay7"):
                continue

            # Cooldown: skip if user received any marketing email in last 24h
            if _received_recent_email(emails_sent):
                continue

            if email:
                send_day7_researcher_stories_task.delay(email, name, doc.id)

                doc.reference.update({"emailsSent.welcomeDay7": now})

                count += 1
                logging.info(f"[BEAT_TASK] Queued Day 7 email for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} Day 7 welcome emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking Day 7 users: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


# ============================================================
# Monthly Recap Beat Task
# ============================================================


@shared_task(
    bind=True,
    name="check_monthly_recap",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_monthly_recap_task(self):
    """
    Monthly task: Send usage recap emails to active subscribers.

    Queries Firestore for active subscribers and computes their usage stats
    for the previous month, then sends a recap email.

    Schedule: Run on the 1st of each month at 14:00 UTC via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for monthly recap eligible users...")

        now = datetime.now(timezone.utc)

        # Query active subscribers — limit to 500 per run to avoid
        # overwhelming Firestore and the Celery worker
        users_ref = db.collection("users")
        query = (
            users_ref.where("subscriptionStatus", "in", ["active", "trial"])
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent this month's recap
            emails_sent = user_data.get("emailsSent", {})
            last_recap = emails_sent.get("monthlyRecap")
            if last_recap:
                # Skip if we already sent a recap this month
                if hasattr(last_recap, "month") and last_recap.month == now.month and last_recap.year == now.year:
                    continue

            if not email:
                continue

            # Compute usage stats from user data
            usage = user_data.get("usageStats", {})
            searches = usage.get("monthlySearches", 0)
            documents = usage.get("monthlyDocuments", 0)
            images = usage.get("monthlyImages", 0)
            notes_count = usage.get("monthlyNotes", 0)
            collections_count = usage.get("monthlyCollections", 0)

            # If no usageStats counters, try counting from Firestore subcollections
            if notes_count == 0:
                try:
                    notes_query = db.collection("users").document(doc.id).collection("notes").count()
                    notes_result = notes_query.get()
                    notes_count = notes_result[0][0].value if notes_result else 0
                except Exception:
                    notes_count = 0

            if collections_count == 0:
                try:
                    coll_query = db.collection("users").document(doc.id).collection("collections").count()
                    coll_result = coll_query.get()
                    collections_count = coll_result[0][0].value if coll_result else 0
                except Exception:
                    collections_count = 0

            # Skip if user had zero activity across all metrics
            if searches == 0 and documents == 0 and images == 0 and notes_count == 0 and collections_count == 0:
                continue

            # Send recap email
            send_monthly_recap_task.delay(
                email, name, searches, documents, images, doc.id,
                notes_count, collections_count,
            )

            # Mark as sent
            doc.reference.update({"emailsSent.monthlyRecap": now})

            count += 1
            logging.info(f"[BEAT_TASK] Queued monthly recap for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} monthly recap emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking monthly recap users: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


# ============================================================
# Renewal Reminder Tasks
# ============================================================


@shared_task(
    bind=True,
    name="send_renewal_reminder_email",
    ignore_result=True,
    soft_time_limit=30,
    time_limit=45,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def send_renewal_reminder_task(
    self,
    email: str,
    user_name: str = "there",
    days_until_renewal: int = 7,
    amount: str = "$9.99",
    user_id: str = None,
):
    """
    Send renewal reminder email.

    Called 7 days before subscription renewal date.
    """
    if not is_valid_email(email):
        logging.warning(f"[EMAIL_TASK] Invalid email, skipping renewal reminder: {email}")
        return {"status": "skipped", "email": email, "reason": "invalid_email"}
        
    # Check if user is unsubscribed
    if check_unsubscribed(email):
        logging.info(f"[EMAIL_TASK] Skipping {email} - user unsubscribed")
        return {"status": "skipped", "email": email, "reason": "unsubscribed"}

    try:
        logging.info(f"[EMAIL_TASK] Sending renewal reminder email to {email}")

        result = email_service.send_renewal_reminder(
            email, user_name, days_until_renewal, amount, user_id
        )
        resend_email_id = result.get("id")

        # Track for analytics
        if user_id:
            track_email_sent(user_id, email, "renewal_reminder", resend_email_id)

        logging.info(f"[EMAIL_TASK] ✓ Renewal reminder email sent to {email}")
        return {"status": "sent", "email": email, "type": "renewal_reminder"}

    except Exception as e:
        logging.error(
            f"[EMAIL_TASK] ❌ Failed to send renewal reminder email to {email}: {e}"
        )
        raise


@shared_task(
    bind=True,
    name="check_renewal_reminders",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_renewal_reminders_task(self):
    """
    Daily task: Find subscribers whose subscriptions renew in ~7 days and send reminder.

    Queries Firestore for users with:
    - Active subscription
    - Renewal date ~7 days from now
    - Haven't received renewal reminder email yet

    Schedule: Run daily at 09:00 UTC via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for upcoming subscription renewals...")

        now = datetime.now(timezone.utc)
        # Window: subscriptions renewing 6.5 to 7.5 days from now
        window_start = now + timedelta(days=6, hours=12)
        window_end = now + timedelta(days=7, hours=12)

        # Query users with active subscriptions and upcoming renewal
        users_ref = db.collection("users")
        query = (
            users_ref.where("subscriptionStatus", "==", "active")
            .where("renewalDate", ">=", window_start)
            .where("renewalDate", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent renewal reminder
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("renewalReminder"):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - renewal reminder already sent"
                )
                continue

            if not email:
                continue

            # Get subscription amount if available
            amount = user_data.get("subscriptionPrice", "$9.99")

            # Send renewal reminder
            send_renewal_reminder_task.delay(email, name, 7, amount, doc.id)

            # Mark as sent
            doc.reference.update({"emailsSent.renewalReminder": now})

            count += 1
            logging.info(f"[BEAT_TASK] Queued renewal reminder for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} renewal reminder emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking renewal reminders: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


# ============================================================
# Re-engagement & Nudge Beat Tasks
# ============================================================


@shared_task(
    bind=True,
    name="check_reengagement_14day",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_reengagement_14day_task(self):
    """
    Daily task: Find users inactive for 14+ days and send re-engagement email.

    Queries Firestore for users with:
    - lastActiveAt > 14 days ago
    - Haven't received reengagement14Day email yet

    Schedule: Run daily via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for users inactive 14+ days...")

        now = datetime.now(timezone.utc)
        # Users whose last activity was 13.5 to 14.5 days ago
        window_start = now - timedelta(days=14, hours=12)
        window_end = now - timedelta(days=13, hours=12)

        users_ref = db.collection("users")
        query = (
            users_ref.where("lastActiveAt", ">=", window_start)
            .where("lastActiveAt", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data, check_stale=True):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent re-engagement email
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("reengagement14Day"):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - 14-day re-engagement already sent"
                )
                continue

            # Cooldown: skip if user received any marketing email in last 24h
            if _received_recent_email(emails_sent):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - received another email recently (cooldown)"
                )
                continue

            if email:
                send_reengagement_14day_task.delay(email, name, doc.id)

                doc.reference.update({"emailsSent.reengagement14Day": now})

                count += 1
                logging.info(f"[BEAT_TASK] Queued 14-day re-engagement email for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} 14-day re-engagement emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking 14-day inactive users: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


@shared_task(
    bind=True,
    name="check_signup_no_trial",
    ignore_result=True,
    soft_time_limit=300,
    time_limit=360,
)
def check_signup_no_trial_task(self):
    """
    Daily task: Find users who signed up 3-4 days ago but never started a trial.

    Queries Firestore for users with:
    - createdAt 3-4 days ago
    - No trial ever started (subscriptionStatus not in active/trial/expired/cancelled)
    - Haven't received signupNoTrialNudge email yet

    Schedule: Run daily via Celery Beat
    """
    from firebase_setup import db

    try:
        logging.info("[BEAT_TASK] Checking for users who signed up but never started trial...")

        now = datetime.now(timezone.utc)
        # Window: users who signed up 3-4 days ago
        window_start = now - timedelta(days=4)
        window_end = now - timedelta(days=3)

        users_ref = db.collection("users")
        query = (
            users_ref.where("createdAt", ">=", window_start)
            .where("createdAt", "<=", window_end)
            .limit(500)
        )

        docs = query.stream()

        count = 0
        for doc in docs:
            user_data = doc.to_dict()
            if _should_skip_user(user_data, check_stale=True):
                continue
            email = user_data.get("email")
            name = user_data.get("displayName", user_data.get("name", "there"))

            # Check if we already sent this nudge
            emails_sent = user_data.get("emailsSent", {})
            if emails_sent.get("signupNoTrialNudge"):
                continue

            # Skip users who have already started a trial or subscribed
            sub_status = user_data.get("subscriptionStatus", "")
            if sub_status in ("active", "trial", "expired", "cancelled"):
                continue

            # Cooldown: skip if user received any marketing email in last 24h
            if _received_recent_email(emails_sent):
                logging.info(
                    f"[BEAT_TASK] Skipping {email} - received another email recently (cooldown)"
                )
                continue

            if email:
                send_signup_no_trial_nudge_task.delay(email, name, doc.id)

                doc.reference.update({"emailsSent.signupNoTrialNudge": now})

                count += 1
                logging.info(f"[BEAT_TASK] Queued no-trial nudge email for {email}")

        logging.info(f"[BEAT_TASK] ✓ Queued {count} signup no-trial nudge emails")
        return {"status": "completed", "emails_queued": count}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error checking no-trial signups: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        raise


# ============================================================
# Email Stats Cache Refresh Task
# ============================================================


@shared_task(
    bind=True,
    name="refresh_email_stats_cache",
    ignore_result=True,
    soft_time_limit=60,
    time_limit=90,
)
def refresh_email_stats_cache_task(self):
    """
    Periodic task: Refresh the email stats cache for common day ranges.

    Pre-computes stats for 7, 30, and 90 day periods and stores in Redis.
    This ensures the /email-stats endpoint returns instantly from cache.

    Schedule: Run every 5 minutes via Celery Beat
    """
    try:
        logging.info("[BEAT_TASK] Refreshing email stats cache...")

        from email_tracking import refresh_stats_cache

        refresh_stats_cache([7, 30, 90])

        logging.info("[BEAT_TASK] ✓ Email stats cache refreshed")
        return {"status": "completed"}

    except Exception as e:
        logging.error(f"[BEAT_TASK] ❌ Error refreshing email stats cache: {e}")
        import traceback

        logging.error(f"[BEAT_TASK] Traceback: {traceback.format_exc()}")
        # Don't raise - this is a non-critical task
        return {"status": "error", "error": str(e)}
