# Chunk Command Center — Execution Plan

## Overview
Transform chunk-analytics from a Mixpanel analytics viewer into a **full Command Center** for running Chunk AI as a solo founder. Integrates RevenueCat API v2, Firestore user data, email campaign tracking, and Mixpanel analytics into a unified operational dashboard.

## Architecture

### Data Sources
1. **RevenueCat API v2** (`https://api.revenuecat.com/v2`) — revenue, subscriptions, customers, entitlements
   - Auth: `REVENUECAT_API_KEY` (already in cerebral env as `sk_iKZq...`)
   - Need: `REVENUECAT_PROJECT_ID` env var (James must get from RC dashboard → Project Settings)
   - Base URL: `https://api.revenuecat.com/v2/projects/{project_id}`
   - Key endpoints: `/customers`, `/customers/{id}/subscriptions`, `/customers/{id}/purchases`
2. **Cerebral API** (Heroku) — email stats, email templates, usage tracking, user data via Firestore
   - Auth: `CEREBRAL_AUTH_TOKEN`
   - Already proxied from chunk-analytics
3. **Mixpanel** — event analytics (searches, features, retention, funnels)
   - Already integrated in all existing pages
4. **Firestore** (via cerebral) — user docs, email tracking, usage stats, notes/collections counts

### API Proxy Pattern
All external API calls go through Next.js API routes (never expose keys to client):
- `/api/rc/*` → RevenueCat API v2 proxy
- `/api/metrics/*` → Cerebral/Mixpanel proxy (existing)
- `/api/email-templates/*` → Cerebral email template API (existing)

### New Cerebral Endpoints Needed
- `GET /api/analytics/revenue-summary` — aggregated revenue data from webhook events (Firestore)
- `GET /api/analytics/subscriber-funnel` — funnel: signup → trial → paid → churned (Firestore)
- `GET /api/analytics/churn-intelligence` — churned users with email history + usage data
- `GET /api/analytics/customer-health` — health scores computed server-side
- `GET /api/analytics/cohort-retention` — cohort analysis from Firestore user data
- `GET /api/analytics/customer/{uid}` — detailed customer profile (Firestore + RC)

---

## New Sidebar Layout

```
COMMAND CENTER
├── 📊 Overview (home) ← redesigned hero with revenue + key metrics
├── 💰 Revenue ← NEW (Tier 1.1)
├── 🔄 Subscriber Funnel ← NEW (Tier 1.2)
├── ⚠️ Churn Intelligence ← NEW (Tier 1.3)
│
PRODUCT ANALYTICS
├── 🔍 Searches
├── 🧪 Research
├── 📝 Notes
├── 📁 Collections
├── ⚡ Features
├── 🚀 Acquisition
│
OPERATIONS
├── 📧 Email Campaigns (existing, enhanced)
├── 👥 Users (existing, enhanced with health scores)
├── 🔔 Push Notifications
├── 📤 Sharing
│
──────────────
👁 Email Templates (bottom link, existing)
CHUNK COMMAND CENTER
```

---

## Phase 1: Backend — RevenueCat Integration + Analytics API
**Location:** `/cerebral`
**Files to create/modify:**

### 1A. RevenueCat API Client (`revenuecat_api.py`)
- RC v2 API client with auth, pagination, rate limiting
- Methods: `list_customers()`, `get_customer()`, `get_customer_subscriptions()`, `get_customer_purchases()`
- Caching layer (Redis with 5-min TTL for list endpoints, 1-min for individual)
- Error handling for RC rate limits (429)

### 1B. Analytics API Blueprint (`analytics_api.py`)
All endpoints return JSON, auth via `verify_webhook_auth`.

**`GET /api/analytics/revenue-summary?days=30`**
Source: Firestore `emailTracking` (conversions with revenue) + RC customer data
Returns:
```json
{
  "mrr": 1250.00,
  "mrrChange": 5.2,
  "arr": 15000.00,
  "todayRevenue": 42.50,
  "totalSubscribers": 142,
  "trialUsers": 23,
  "byPlatform": {"ios": 850, "web": 300, "android": 100},
  "byProduct": {"monthly": 900, "annual": 350},
  "mrrTrend": [{"date": "2026-02-01", "mrr": 1180}, ...],
  "newSubscribers": 12,
  "churned": 3,
  "netNew": 9
}
```

**`GET /api/analytics/subscriber-funnel?days=30`**
Source: Firestore `users` collection
Returns:
```json
{
  "funnel": [
    {"stage": "Signed Up", "count": 450, "rate": 100},
    {"stage": "Started Trial", "count": 180, "rate": 40},
    {"stage": "Trial → Paid", "count": 72, "rate": 40},
    {"stage": "Active (30d+)", "count": 142, "rate": 78.8},
    {"stage": "Churned", "count": 38, "rate": 21.2}
  ],
  "trialConversionRate": 40.0,
  "medianDaysToConvert": 4.2,
  "conversionByPlatform": {"ios": 42, "web": 35, "android": 38},
  "weekOverWeek": {"trialStarts": 2.3, "conversions": -1.1}
}
```

**`GET /api/analytics/churn-intelligence?days=90`**
Source: Firestore `users` + `emailTracking`
Returns:
```json
{
  "churnRate": 8.2,
  "churnRateTrend": [{"date": "2026-01-01", "rate": 9.1}, ...],
  "atRiskUsers": [
    {"uid": "...", "email": "...", "lastActive": "2026-02-20", "daysSinceActive": 12, "healthScore": 25, "subscriptionAge": 45, "platform": "ios"}
  ],
  "churnedUsers": [
    {"uid": "...", "email": "...", "churnDate": "2026-02-25", "tenure": 30, "emailsReceived": ["winback7Day"], "emailsOpened": ["winback7Day"], "platform": "ios", "usage": {"searches": 12, "notes": 3}}
  ],
  "winbackEffectiveness": {
    "winback7Day": {"sent": 20, "recovered": 4, "rate": 20.0},
    "winback30Day": {"sent": 15, "recovered": 1, "rate": 6.7}
  },
  "churnReasons": {"price": 5, "not_using": 12, "switching": 2, "unknown": 19}
}
```

**`GET /api/analytics/customer-health`**
Source: Firestore `users` (computed server-side)
Returns:
```json
{
  "distribution": {"healthy": 95, "atRisk": 32, "churning": 15},
  "customers": [
    {
      "uid": "...", "email": "...", "name": "...",
      "healthScore": 85,
      "healthStatus": "healthy",
      "factors": {
        "recency": 95, "frequency": 80, "featureDepth": 70, "tenure": 90, "emailEngagement": 85
      },
      "subscriptionStatus": "active",
      "platform": "ios",
      "lastActiveAt": "2026-03-03",
      "subscribedDays": 120
    }
  ],
  "averageHealthScore": 68
}
```

**`GET /api/analytics/cohort-retention?months=6`**
Source: Firestore `users` grouped by signup month
Returns:
```json
{
  "cohorts": [
    {
      "month": "2025-10",
      "signups": 45,
      "retention": [100, 72, 65, 58, 52, 48],
      "revenue": 2400
    }
  ]
}
```

**`GET /api/analytics/customer/{uid}`**
Source: Firestore + RevenueCat API
Returns: Full customer profile with subscription history, email timeline, usage stats

### 1C. Scheduled Data Aggregation (`analytics_tasks.py`)
Celery beat tasks that pre-compute expensive analytics:
- `aggregate_revenue_data` — every 15 min, computes MRR/ARR from Firestore subscription data
- `compute_health_scores` — every 6 hours, scores all active users
- `compute_cohort_data` — daily at 06:00 UTC
- Results cached in Redis (or Firestore `analytics_cache` collection as fallback)

### 1D. Register in `main.py`
- Import and register `analytics_api_bp`
- Add new Celery tasks to beat schedule

---

## Phase 2: Frontend — New Dashboard Pages
**Location:** `/chunk-analytics`

### 2A. Sidebar Restructure (`Sidebar.tsx`)
- Group nav items into sections: COMMAND CENTER, PRODUCT ANALYTICS, OPERATIONS
- Section headers with subtle dividers
- Highlight active section
- Add new nav items: Revenue, Subscriber Funnel, Churn Intelligence
- Reorder for operational priority (revenue first)

### 2B. Overview Page Redesign (`app/page.tsx`)
Transform from basic Mixpanel stats to a **Command Center home**:
- **Hero row**: MRR (big number), Today's Revenue, Active Subscribers, Trial Users, Churn Rate
- **MRR trend chart** (area chart, 30/60/90d)
- **Quick health**: subscriber funnel mini-visualization + email campaign performance
- **Recent activity feed**: latest subscription events (new, churned, converted)
- **Alerts panel**: at-risk users, billing issues, anomalies

### 2C. Revenue Page (`app/revenue/page.tsx`) — NEW
- **Stat cards**: MRR, ARR, Today's Revenue, Net New MRR, MRR Growth %
- **MRR trend chart** (area, with monthly/weekly toggle)
- **Revenue by platform** (pie chart: iOS vs Web vs Android)
- **Revenue by product** (bar chart: monthly vs annual)
- **Revenue breakdown table**: per-product with subscriber count, ARPU, LTV estimate
- **Revenue events timeline**: recent purchases, renewals, refunds

### 2D. Subscriber Funnel Page (`app/funnel/page.tsx`) — NEW (replaces existing subscriptions page)
- **Funnel visualization**: Signup → Trial → Paid → Active → Churned (animated steps)
- **Stat cards**: Trial-to-Paid Rate, Median Days to Convert, Weekly Trials, Weekly Conversions
- **Conversion by platform** (grouped bar chart)
- **Time-to-convert distribution** (histogram)
- **Week-over-week deltas** for each funnel stage

### 2E. Churn Intelligence Page (`app/churn/page.tsx`) — NEW
- **Stat cards**: Monthly Churn Rate, At-Risk Users, Winback Rate, Avg Tenure Before Churn
- **Churn trend chart** (line chart, rolling 30d)
- **At-risk users table**: sortable by health score, last active, tenure — with action buttons (send email, view profile)
- **Churned users list**: searchable, shows tenure, emails received/opened, platform
- **Winback effectiveness**: bar chart comparing winback email types
- **Churn reasons** (pie chart, if RC cancellation data available)

### 2F. Customer Health Page (`app/users/page.tsx`) — ENHANCE existing Users page
- **Health distribution chart** (donut: 🟢 Healthy / 🟡 At Risk / 🔴 Churning)
- **Customer table** with health score, color-coded status, last active, platform, subscription age
- **Click to expand**: full customer detail (subscription history, email timeline, usage)
- **Filters**: by health status, platform, subscription age
- **Average health score** trend over time

### 2G. API Proxy Routes
- `app/api/rc/revenue-summary/route.ts` → cerebral `/api/analytics/revenue-summary`
- `app/api/rc/subscriber-funnel/route.ts` → cerebral `/api/analytics/subscriber-funnel`
- `app/api/rc/churn-intelligence/route.ts` → cerebral `/api/analytics/churn-intelligence`
- `app/api/rc/customer-health/route.ts` → cerebral `/api/analytics/customer-health`
- `app/api/rc/customer/[uid]/route.ts` → cerebral `/api/analytics/customer/{uid}`

---

## Phase 3: Email Campaign ROI + Enhancements
**Both cerebral + chunk-analytics**

### 3A. Revenue Attribution in Email Stats
- Update `email_tracking.py` to store `revenue_attributed` per conversion
- Update `check_and_mark_conversion` to capture purchase amount from RC webhook data
- Add `revenue_per_email_type` to stats endpoint response

### 3B. Email ROI Section on Email Campaigns Page
- Revenue attributed per campaign type
- Cost per recovery (based on Resend pricing ~$1/1000 emails)
- ROI calculation: revenue recovered / email cost

---

## Phase 4: Weekly Digest + Alerts
**cerebral**

### 4A. Weekly Digest Email Task
- New Celery beat task: Mondays at 14:00 UTC
- Computes: MRR change, new/churned subscribers, trial conversions, email performance, anomalies
- Sends to James via Resend using a new `get_weekly_digest_email()` template
- Template: clean summary with sparklines (inline images) or text-based charts

### 4B. Anomaly Detection
- Simple threshold-based alerts in the health score computation:
  - Churn spike (>2x normal rate)
  - Billing issue surge
  - Revenue drop
- Surface as red alert cards on Overview page

---

## Execution Order (Parallelizable)

### Stream A (Backend): Phase 1A → 1B → 1C → 1D → 3A → 4A
All cerebral backend work. Can run as one sequential sub-agent.

### Stream B (Frontend Core): Phase 2A → 2B → 2C → 2D → 2E
Sidebar restructure + new pages. Depends on API routes being defined (can use mock data initially).

### Stream C (Frontend Enhancement): Phase 2F → 2G → 3B → 4B
Users page enhancement, proxy routes, email ROI, alerts. Can start after Stream B sidebar is done.

### Dependencies
- Stream B proxy routes (2G) need Stream A endpoints to return real data
- Stream B can use mock/skeleton data while Stream A is building
- Stream C depends on Stream B sidebar being done
- Phase 3A (revenue attribution) is a cerebral-only change, independent
- Phase 4 (digest + alerts) depends on Phase 1 analytics API

---

## Environment Setup Required (James)
1. **RevenueCat Project ID**: Go to RC Dashboard → Project Settings → copy project ID
   - Add to Heroku: `heroku config:set REVENUECAT_PROJECT_ID=proj_xxx`
2. **RevenueCat API v2 Key**: The existing `REVENUECAT_API_KEY` (`sk_iKZq...`) should work if it has v2 permissions
   - Verify at: RC Dashboard → Project Settings → API Keys → ensure "v2 Read" is enabled
3. **Firestore indexes**: May need additional composite indexes (will be identified during build)

---

## File Inventory (New Files)

### cerebral (backend)
- `revenuecat_api.py` — RC v2 API client
- `analytics_api.py` — Analytics API blueprint (6 endpoints)
- `analytics_tasks.py` — Celery beat tasks for pre-computation
- Modified: `main.py` (register blueprint + beat tasks), `celery_config.py` (new beat schedule), `email_tracking.py` (revenue attribution)

### chunk-analytics (frontend)
- `src/app/revenue/page.tsx` — Revenue dashboard
- `src/app/funnel/page.tsx` — Subscriber funnel (replaces subscriptions)
- `src/app/churn/page.tsx` — Churn intelligence
- `src/app/api/rc/revenue-summary/route.ts` — proxy
- `src/app/api/rc/subscriber-funnel/route.ts` — proxy
- `src/app/api/rc/churn-intelligence/route.ts` — proxy
- `src/app/api/rc/customer-health/route.ts` — proxy
- `src/app/api/rc/customer/[uid]/route.ts` — proxy
- Modified: `src/components/layout/Sidebar.tsx` (restructured), `src/app/page.tsx` (redesigned), `src/app/users/page.tsx` (health scores), `src/app/emails/page.tsx` (ROI section)

---

## Design System (existing, reuse)
- **Colors**: `bg_dark` #1E1E1E, `primary` #E84D2B (accent/red), `accent_blue`, `signal_green` #4ADE80, `purple`
- **Fonts**: Space Grotesk (sans), Space Mono (mono), serif for statements
- **Components**: StatCard, ChartCard, AreaChart, BarChart, PieChart, LineChart, DataTable, FunnelChart
- **Animations**: GSAP stagger on load (existing pattern)
- **Dark theme**: zinc-900/zinc-800 backgrounds, zinc-500 muted text
