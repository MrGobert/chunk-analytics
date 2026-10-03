"""
The values of ``users/{uid}.subscriptionStatus`` that mean a subscription was
cancelled or has expired.

Two writers spell a cancellation differently:

- cerebral's RevenueCat webhook (webhooks_revenuecat.py) writes "cancelled" on
  CANCELLATION and "expired" on EXPIRATION.
- The Cloud Function ``updateSubscriptionStatus`` (semantic/firebase_functions)
  writes "canceled" on both. It runs on every new ``subscription_events`` doc,
  and whichever writer lands last keeps its value.

On 2026-10-03, 457 prod accounts read "canceled", against 51 "expired" and 7
"cancelled". 449 of the 457 last saw an EXPIRATION, and none had a win-back:
the beats matched only cerebral's spellings.

Match both spellings in every comparison and in the email beats' queries.
Those queries are indexed one-day windows on expirationDate, so they read only
the accounts in the window.

The analytics snapshot's status scans (revenue summary, subscriber funnel,
churn intelligence, customer health) still read cerebral's spellings only.
Every 15-minute run scans the cancelled group 10 times (three windows of three
views, plus customer health). The 457 "canceled" docs would add about 4,600
reads a run, some 440k a day, more than doubling the snapshot's Firestore
reads. On 2026-10-03 they changed one figure: the 90-day churn rate went from
33.9% to 64.9%, and that figure is wrong. Most "canceled" docs are a July 2026
batch of about 100 web trials with no trial or webhook fields, and churn
intelligence has no provenance screen to keep them out of paid churn.
"""

CANCELLED_STATUSES = ("cancelled", "canceled")

# Subscriptions that won't renew. A cancelled one keeps its access until
# expirationDate, so pair these with expirationDate to find who has lost it.
CHURNED_STATUSES = ("expired",) + CANCELLED_STATUSES
