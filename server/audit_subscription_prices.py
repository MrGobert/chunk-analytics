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
    sandbox_only, promotional = A._non_paying_uids_from_events(db, now - timedelta(days=400))
    held_out = A._excluded_uids()
    print(f"\nevent-mirror screens: {len(sandbox_only)} sandbox-only, "
          f"{len(promotional)} promotional-only app_user_id(s)")
    print(f"ANALYTICS_EXCLUDED_UIDS holds {len(held_out)} uid(s)")

    reasons = Counter()
    confirmed, comped = [], []
    for doc in active:
        data = doc.to_dict() or {}
        if doc.id in held_out:
            reasons["held out by ANALYTICS_EXCLUDED_UIDS"] += 1
        elif doc.id in sandbox_only:
            reasons["sandbox only"] += 1
        elif doc.id in promotional:
            reasons["promotional period / non-paying store (mirror)"] += 1
        elif A._is_promotional(data):
            reasons["promotional or test store (user doc)"] += 1
        elif not A._has_webhook_provenance(data):
            reasons["no webhook provenance (client-written)"] += 1
        elif A._is_unconverted_trial(data, now):
            reasons["live trial flipped to active"] += 1
        elif A._is_free_access(data):
            reasons["free access (currency recorded, price 0)"] += 1
            comped.append(doc)
        elif A._has_lapsed_renewal(data, now):
            reasons["renewal date already passed"] += 1
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

    if comped:
        print(f"\nfree-access accounts ({len(comped)}) — granted, never charged")
        for doc in comped:
            d = doc.to_dict() or {}
            print(f"  {doc.id[:10]}…  store={d.get('subscriptionStore') or '?':<14} "
                  f"currency={d.get('subscriptionCurrency') or '?':<5} "
                  f"product={str(d.get('productId') or '?')[:28]}")

    print("\nunpriced reason across webhook-confirmed subscribers")
    for reason, count in Counter(A._unpriced_reason(d.to_dict() or {}) for d in confirmed
                                 if A._monthly_usd(d.to_dict() or {}, d.id) is None).most_common():
        print(f"  {reason:<20} {count}")

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
