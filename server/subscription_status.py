"""
The values of ``users/{uid}.subscriptionStatus`` that mean a subscription was
cancelled or has expired.

Two writers spelled a cancellation differently:

- cerebral's RevenueCat webhook (webhooks_revenuecat.py) writes "cancelled" on
  CANCELLATION and "expired" on EXPIRATION.
- The Cloud Function ``updateSubscriptionStatus`` (semantic/firebase_functions)
  wrote "canceled" on both, racing the webhook, until it was deleted on
  2026-10-03. The accounts it last wrote still read "canceled".

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
reads.

Churn intelligence doesn't need them. It counts paid churn from the
subscription ledger and reads by id the docs of the paid churners the scans
missed (analytics_api._churn_in_window): 5 "canceled" docs for the 90-day
window on 2026-10-04. A scan wouldn't have counted 3 of them, which have no
expirationDate. 97 of the other 102 "canceled" docs that ended in that window
are a July 2026 batch of web trials with no trial or webhook fields: trial
fallout, not paid churn, and the churned list leaves them out.
"""

CANCELLED_STATUSES = ("cancelled", "canceled")

# Subscriptions that won't renew. A cancelled one keeps its access until
# expirationDate, so pair these with expirationDate to find who has lost it.
CHURNED_STATUSES = ("expired",) + CANCELLED_STATUSES
