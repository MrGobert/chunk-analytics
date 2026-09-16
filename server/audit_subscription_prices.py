"""Read-only audit of the subscription data behind MRR.

Answers the questions the September 2026 inflation incident left open:
which currencies are stored in users/{uid}.subscriptionPrice, how many
"active" documents the RevenueCat webhook actually stands behind, and what
share of confirmed subscribers we can price in USD.

Writes nothing. Prints no email addresses; user ids are truncated.

    heroku run -a cerebral-analytics python audit_subscription_prices.py
"""

import logging
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.WARNING)

sys.path.insert(0, ".")
import analytics_api as A  # noqa: E402


def main():
    from firebase_setup import db

    now = datetime.now(timezone.utc)
    users = db.collection("users")

    buckets = {
        status: list(users.where("subscriptionStatus", "==", status).limit(5000).stream())
        for status in ("active", "trial", "expired", "cancelled")
    }
    print("subscriptionStatus counts")
    for status, docs in buckets.items():
        flag = "  << hit the 5000 cap" if len(docs) == 5000 else ""
        print(f"  {status:<10} {len(docs)}{flag}")

    active = buckets["active"]
    sandbox_only = A._sandbox_only_app_user_ids(db, now - timedelta(days=400))
    print(f"\nsandbox-only app_user_ids in the event mirror: {len(sandbox_only)}")

    reasons = Counter()
    confirmed = []
    for doc in active:
        data = doc.to_dict() or {}
        if doc.id in sandbox_only:
            reasons["sandbox only"] += 1
        elif A._is_promotional(data):
            reasons["promotional grant"] += 1
        elif not A._has_webhook_provenance(data):
            reasons["no webhook provenance (client-written)"] += 1
        elif A._has_lapsed_renewal(data, now):
            reasons["renewal date already passed"] += 1
        elif A._is_unconverted_trial(data, now):
            reasons["live trial flipped to active"] += 1
        else:
            confirmed.append(doc)

    print(f"\nof {len(active)} 'active' documents, {len(confirmed)} are webhook-confirmed")
    for reason, count in reasons.most_common():
        print(f"  excluded {count:>4}  {reason}")

    print("\nrenewalDate coverage across 'active'")
    coverage = Counter()
    for doc in active:
        renewal = A._to_datetime((doc.to_dict() or {}).get("renewalDate"))
        coverage["missing" if not renewal else ("future" if renewal > now else "past")] += 1
    for key, count in coverage.most_common():
        print(f"  {key:<8} {count}")

    print("\nsubscriptionCurrency across webhook-confirmed subscribers")
    by_currency = defaultdict(list)
    for doc in confirmed:
        data = doc.to_dict() or {}
        raw = data.get("subscriptionPrice")
        currency = str(data.get("subscriptionCurrency") or "").strip().upper() or "(none)"
        by_currency[currency].append((doc.id, raw))
    if not by_currency:
        print("  (no confirmed subscribers)")
    for currency, rows in sorted(by_currency.items(), key=lambda kv: -len(kv[1])):
        priced = [r for _, r in rows if isinstance(r, (int, float))]
        span = f"  min {min(priced):,.2f}  max {max(priced):,.2f}" if priced else "  no prices"
        print(f"  {currency:<8} {len(rows):>4} subscriber(s){span}")
        if currency not in ("USD", "(none)"):
            for uid, raw in rows[:5]:
                print(f"            {uid[:8]}…  {raw}")

    priced = sum(1 for d in confirmed if A._monthly_usd(d.to_dict() or {}, d.id) is not None)
    mrr = sum(A._monthly_usd(d.to_dict() or {}, d.id) or 0 for d in confirmed)
    pct = (priced / len(confirmed) * 100) if confirmed else 0
    print(f"\nUSD-priced coverage: {priced} of {len(confirmed)} confirmed ({pct:.0f}%)")
    print(f"MRR from priced subscribers: ${mrr:,.2f}   ARR ${mrr * 12:,.2f}")

    # What the old code reported, for comparison.
    legacy = 0.0
    for doc in active:
        data = doc.to_dict() or {}
        p = float(data.get("subscriptionPrice") or 9.99)
        legacy += round(p / 12, 2) if A._is_annual_plan(data, p) else p
    print(f"Pre-fix math over the same documents would report: ${legacy:,.2f}")


if __name__ == "__main__":
    main()
