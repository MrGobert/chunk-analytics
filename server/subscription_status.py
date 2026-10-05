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

The analytics snapshot's status scans (subscriber funnel and churn
intelligence, and the revenue summary and customer health when the ledger
can't be read) still read cerebral's spellings only. Every 15-minute run scans
the cancelled group 6 times (three windows of two views). The 457 "canceled"
docs would add about 2,700 reads a run, some 260k a day.

Churn intelligence doesn't need them. It counts paid churn from the
subscription ledger and reads by id the docs of the paid churners the scans
missed (analytics_api._churn_in_window): 5 "canceled" docs for the 90-day
window on 2026-10-04. A scan wouldn't have counted 3 of them, which have no
expirationDate. 97 of the other 102 "canceled" docs that ended in that window
are a July 2026 batch of web trials with no trial or webhook fields: trial
fallout, not paid churn, and the churned list leaves them out.

Nor do the Customers page's at-risk and engaged lists and health cards. They
read by id the docs of the accounts the ledger says are paying or trialling
(analytics_api._ledger_customers): 3 paying accounts read "canceled" on
2026-10-05, and the scans had left them out.
"""

CANCELLED_STATUSES = ("cancelled", "canceled")

# Subscriptions that won't renew. A cancelled one keeps its access until
# expirationDate, so pair these with expirationDate to find who has lost it.
CHURNED_STATUSES = ("expired",) + CANCELLED_STATUSES
