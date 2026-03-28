# Chunk Analytics — Command Center

Internal analytics dashboard and automated email platform for [Chunk AI](https://chunkapp.com), an AI-powered research app (iOS, macOS, visionOS, web).

## Goals

1. **Business visibility** — MRR, ARR, churn, subscriber funnels, customer health scores in one place
2. **Product analytics** — searches, research usage, notes, collections, feature adoption, acquisition funnels (all from Mixpanel)
3. **Automated lifecycle emails** — welcome drip, trial nudges, churn winback, renewal reminders, monthly recaps (via Resend)
4. **Email performance tracking** — delivery, open, click, bounce, and conversion attribution per email type

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   chunk-analytics                    │
│               (Next.js 16 · Vercel)                  │
│                                                     │
│  /api/metrics/*  ─── Mixpanel Export API ───────────┤
│  /api/rc/*       ─── cerebral-analytics API ────────┤
│  /api/email-*    ─── cerebral-analytics API ────────┤
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              cerebral-analytics (server/)             │
│          (Flask + Celery · Heroku · 2 dynos)         │
│                                                     │
│  web dyno   → Flask API (analytics endpoints)       │
│  worker dyno → Celery + Beat (email scheduling)     │
│                                                     │
│  Data sources:                                      │
│    Firestore  → users, emailTracking, emailUnsubs   │
│    Redis      → analytics cache, email stats cache  │
│    Resend     → transactional email delivery        │
└─────────────────────────────────────────────────────┘
```

The frontend is a **Next.js monorepo** deployed on **Vercel**. The backend (`server/` subdirectory) is a **separate Heroku app** (`cerebral-analytics`) deployed via GitHub Actions git subtree push.

## Frontend (Next.js)

### Tech Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Recharts for charts, Lucide for icons, GSAP for animations
- Deployed on Vercel (auto-deploy from `main`)

### Data Flow

Two categories of dashboard pages, each with different data sources:

**Product Analytics pages** (`/api/metrics/*`) — fetch from **Mixpanel Export API** directly:
- Overview, Searches, Research, Notes, Collections, Features, Acquisition, Users, Push, Sharing
- The Next.js API routes call Mixpanel's `/export` endpoint, parse NDJSON, filter/aggregate in-memory
- Events are cached to disk (`/tmp`) and in-memory with a 5-minute TTL + file-locking to prevent duplicate fetches across workers

**Command Center pages** (`/api/rc/*`) — proxy to **cerebral-analytics Flask API**:
- Revenue, Subscriber Funnel, Churn Intelligence, Customer Health
- The Next.js routes forward requests with an auth token to the Heroku backend
- Backend queries Firestore directly for subscription/user data

**Email pages** (`/api/metrics/emails`) — hybrid:
- Email campaign stats come from cerebral-analytics (`/api/analytics/email-stats`)
- Template previews rendered client-side from backend template definitions

### Key Modules

| File | Purpose |
|------|---------|
| `src/lib/mixpanel.ts` | Mixpanel API client, event fetching, caching, user categorization (visitor/authenticated/subscriber), platform filtering |
| `src/lib/event-cache.ts` | Disk + memory cache with file-locking for Mixpanel export data (~39MB) |
| `src/hooks/useAnalytics.tsx` | SWR-like data hook with stale-while-revalidate, session storage persistence, cross-tab prefetching |
| `src/hooks/useDashboardFilters.ts` | Shared state for date range, platform, and user type filters |
| `src/components/layout/Sidebar.tsx` | Navigation with adjacent-page prefetching |

### Filters (global)

Every product analytics page supports:
- **Date range**: 1d, 7d, 30d, 90d, 365d, or custom from/to
- **Platform**: all, web, iOS, iPadOS, macOS, visionOS
- **User type**: all, visitors, authenticated, subscribers

### Environment Variables (Vercel)

| Variable | Source |
|----------|--------|
| `MIXPANEL_API_SECRET` | Mixpanel project — authenticates Export API |
| `ANALYTICS_API_URL` | cerebral-analytics Heroku URL |
| `CEREBRAL_AUTH_TOKEN` | Shared secret for Flask API auth |

## Backend — `server/`

### Tech Stack

- Flask (web), Celery + Beat (worker), Redis (broker/cache), Firestore (data)
- Deployed on Heroku as `cerebral-analytics` — 2 dynos (web + worker)
- GitHub Actions auto-deploys when `server/**` changes

### Flask API (`analytics_api.py`)

Five endpoints under `/api/analytics/`:

| Endpoint | What it computes |
|----------|-----------------|
| `GET /revenue-summary` | MRR, ARR, subscriber count, churn rate, MRR trend, platform/product breakdown |
| `GET /subscriber-funnel` | Signup → trial → paid → active → churned funnel with conversion rates |
| `GET /churn-intelligence` | At-risk users, churned user detail, winback effectiveness, churn reasons |
| `GET /customer-health` | Health scores (0-100) for all active/trial users with 5-factor algorithm |
| `GET /customer/<uid>` | Individual customer detail: health, usage, email history, subscription timeline |

All endpoints require auth (`Authorization` header = `REVENUECAT_WEBHOOK_AUTH` env var). Results are cached in Redis (15-min TTL) and pre-computed every 15 minutes by a Celery beat task.

#### Health Score Algorithm

Weighted composite of 5 factors:
- Recency (35%) — days since last active (0 after 30 days; halves tenure when inactive)
- Usage frequency (25%) — monthly searches (20+ = max)
- Feature depth (20%) — number of distinct features used (4+ = max)
- Tenure (10%) — days since account creation (maxes at ~150 days)
- Email engagement (10%) — emails received/interacted with

Score → status: ≥60 healthy, ≥30 atRisk, <30 churning.

### Celery Beat Schedule (`celery_app.py`)

| Task | Schedule | Purpose |
|------|----------|---------|
| `check_trials_ending_soon` | Every 6h | Send trial-ending email to users whose trial ends within 12h |
| `check_churned_users_7day` | Daily 10:00 UTC | 7-day winback email |
| `check_churned_users_30day` | Daily 10:30 UTC | 30-day winback email |
| `check_welcome_sequence_day1` | Every 6h | Day 1 welcome email (~24h after signup) |
| `check_welcome_sequence_day3` | Daily 11:00 UTC | Day 3 Collections feature email |
| `check_welcome_sequence_day7` | Daily 11:30 UTC | Day 7 researcher stories email |
| `check_monthly_recap` | 1st of month, 14:00 UTC | Usage recap for active subscribers |
| `check_renewal_reminders` | Daily 09:00 UTC | 7-day renewal reminder |
| `check_reengagement_14day` | Daily 12:00 UTC | Re-engagement for 14-day inactive users |
| `check_signup_no_trial` | Daily 12:30 UTC | Nudge for users who signed up but never started trial |
| `refresh_email_stats_cache` | Every 5 min | Pre-compute email conversion stats in Redis |
| `compute_analytics_snapshot` | Every 15 min | Pre-compute revenue/funnel/churn/health data in Redis |
| `snapshot_daily_mrr` | Daily 23:55 UTC | Snapshot MRR to Redis + Firestore for trend chart |

### Email System

**Sending**: `email_service.py` → Resend API. All emails use a "Brutalist Signal" HTML design system matching Chunk's brand. Each template returns `(subject, html, plaintext)`.

**Templates** (13 types):
- Welcome sequence: day1_superpowers, day3_collections, day7_researcher_stories
- Trial: trial_started, trial_ending
- Churn: subscription_expired, winback_7day, winback_30day
- Engagement: reengagement_14day, signup_no_trial_nudge, monthly_recap
- Operational: renewal_reminder, billing_issue, feature_announcement

**Safeguards** (`email_tasks.py`):
- 24-hour cooldown between marketing emails to the same user
- Unsubscribe check before every send (Firestore `emailUnsubscribes` collection)
- Stale account filtering (>12 months old excluded from winback/re-engagement)
- Deduplication via `emailsSent` flags on user documents
- Invalid/test email filtering

**Tracking** (`email_tracking.py`):
- Every sent email logged to Firestore `emailTracking` collection
- Conversion attribution: when a user converts (purchase/renewal), all emails sent within 30 days are marked as contributing
- Delivery events (delivered, opened, clicked, bounced) updated via Resend webhook → `update_email_event()`
- Stats cached in Redis, refreshed every 5 min

### Firestore Collections Used

| Collection | Purpose |
|------------|---------|
| `users` | User profiles, subscription status, usage stats, `emailsSent` flags |
| `emailTracking` | Per-email send records with delivery/conversion tracking |
| `emailUnsubscribes` | Unsubscribed email addresses |
| `analytics_cache` | Firestore fallback for MRR history when Redis is unavailable |
| `users/{uid}/notes` | User notes (queried for monthly recap counts) |
| `users/{uid}/collections` | User collections (queried for monthly recap counts) |
| `users/{uid}/deleted_notes` | Deletion tombstones for cross-platform sync |

### Environment Variables (Heroku)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Firebase service account JSON |
| `REDIS_URL` | Heroku Redis (`rediss://` TLS) |
| `RESEND_API_KEY` | Resend email API |
| `REVENUECAT_WEBHOOK_AUTH` | Shared auth token (Flask API + RevenueCat webhooks) |
| `EMAIL_UNSUBSCRIBE_SECRET` | HMAC secret for unsubscribe token generation |
| `EMAIL_UNSUBSCRIBE_BASE_URL` | Base URL for unsubscribe links (points to cerebral) |

## Deployment

| Component | Platform | Trigger |
|-----------|----------|---------|
| Frontend (Next.js) | Vercel | Push to `main` |
| Backend (Flask/Celery) | Heroku (`cerebral-analytics`) | GitHub Actions on `server/**` changes — uses git subtree push |

GitHub Actions workflow: `.github/workflows/deploy-server.yml`. Requires `HEROKU_API_KEY` and `HEROKU_EMAIL` secrets on the repo.

## Development

```bash
# Frontend
npm install
npm run dev          # localhost:3000

# Backend
cd server/
pip install -r requirements.txt
flask run            # localhost:5000
celery -A celery_app worker --beat --loglevel INFO
```

Needs: Mixpanel API secret, Firebase service account, Redis instance, Resend API key.
