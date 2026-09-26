# Native new-user measurement

The Activation and Acquisition pages display successful-value cohorts for iOS, iPadOS, macOS, and visionOS. The existing action-based Activation definition remains available and unchanged: sent searches, report requests, and created collections are recorded actions, not evidence of a useful result.

## Event contract

Authenticated native journey events include `account_id`, `journey_version` (initially `1`), `platform`, `device_family`, and `app_version`. Do not include prompts, answers, document text, or other user content.

Include `journey_version` on account creation, before waiting for the tour. The aggregator can infer version from a subsequent journey event as a compatibility fallback, but accounts without any version evidence are labeled legacy and excluded from successful-value denominators. Consistent signup instrumentation prevents selection bias toward users who engage.

| Event | Additional properties | Meaning |
| --- | --- | --- |
| `Journey_Started` | — | Account enrolled in the journey before any tour or value interaction; establishes version evidence |
| `Journey_Tour_Viewed` | — | Tour presented, including manual replay |
| `Journey_Tour_Page_Viewed` | `page` | A page became visible |
| `Journey_Tour_Action_Selected` | `destination` | A task CTA was selected; not successful value |
| `Journey_Tour_Dismissed` | `reason` | Tour closed |
| `Journey_Value_Completed` | `value_id`, `value_kind`, `is_visible` | A successful outcome exists; background completion sets visibility false |
| `Journey_Value_Viewed` | `value_id`, `value_kind` | An existing successful outcome was delivered to the user |

`value_kind` is one of `chat`, `note`, `artifact`, `research`, `collection`, `automation`, `capture`, `siri`, or `shortcuts`. `value_id` is a stable opaque outcome ID across retries and devices. Completion with `is_visible: true` establishes delivery immediately. Otherwise a matching subsequent Viewed event is required. Missing visibility is conservatively treated as background. A displayed failure, cancelled result, empty collection, or loading completion must not emit successful Completed. The aggregator also rejects explicit failure/empty properties.

Continue using `Paywall_Viewed`, `Paywall_Dismissed`, `Plan_Selected`, `Purchase_Initiated`, `Purchase_Completed`, `Purchase_Failed`, and `Purchase_Cancelled`. The new automatic source is `onboarding_first_value`. Pass the same source to purchase and dismissal events. Legacy `automatic_first_query` and every contextual source remain independently visible. Client `Purchase_Completed` needs explicit `is_trial` (or `has_trial`) metadata to distinguish trials from non-trial checkouts; missing metadata stays unknown.

## Identity and observation windows

- Signup dates and export date boundaries use the Mixpanel project's UTC calendar. Select accounts by their first observed signup within the chosen date range and their signup platform; follow their subsequent activity on all devices.
- Prefer `account_id` / `$user_id`; accept unambiguous `$identify` and alias links. Never join accounts using a shared device ID. Anonymous identities with multiple account candidates remain separate.
- Exports extend through the cohort's final date plus 30 days, capped at today. Maturity is additionally capped at the export's fetch timestamp, including stale cached exports.
- Successful value within 24 hours requires a complete 24-hour observation window. Its median includes only successful accounts within that window.
- Non-chat adoption within seven elapsed days requires seven full days of observation.
- Meaningful day-seven return is a delivered successful outcome in `[signup + 7 days, signup + 8 days)`, requiring eight full days of observation. A session open is not meaningful return.
- Thirty-day acquisition follows the same account through signup, delivered value, paywall, and checkout in order. Only accounts observed for 30 days enter the funnel. Tour interaction is measured separately because skipping or directly starting work is valid.
- Metrics show each eligible denominator and the number of instrumented accounts. No mature, instrumented accounts produces an unavailable rate, not zero. Journey-version, signup-platform, and device-family segments are visible in both dashboards. Legacy accounts remain visible in signup totals but do not enter successful-value denominators or the new acquisition funnel.

Exact iPhone/iPad attribution uses explicit platform and `device_family`, with `$model` as a legacy iPad fallback. The global historical iOS filter keeps its previous iPhone-and-iPad umbrella behavior; new journey/acquisition cohorts use separate iOS and iPadOS signup populations.

## Revenue and interpretation

The product-event dataset has no authoritative account-level transaction ledger with trial conversion, refunds, and currency normalization. Paid conversion and revenue per new account therefore display **Unavailable**. Client checkout counts are diagnostic and do not claim paid subscriptions or net revenue. Aggregate RevenueCat revenue elsewhere in the app cannot establish this signup cohort's revenue.

Review mature signup cohorts after release, segmented by journey version and native platform. Before/after changes alone do not prove causation. No live Mixpanel data or deployment is required for local aggregation tests.

## Validation

Run `npm test`, `npx tsc --noEmit`, and ESLint on changed files. Journey tests cover successful versus attempted work, background delivery, duplicate and out-of-order events, account aliases and shared devices, all native platforms, cohort/end-date boundaries, distinct maturity windows, source attribution, unknown trial metadata, and unavailable authoritative revenue.
