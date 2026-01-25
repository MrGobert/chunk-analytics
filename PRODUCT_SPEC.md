# Chunk Analytics Dashboard — Product Specification

## Overview
A custom analytics dashboard to visualize usage data from the Chunk AI app, pulling data from Mixpanel via their API.

## Tech Stack
- **Framework:** Next.js 14+ (App Router)
- **Styling:** Tailwind CSS
- **Charts:** Recharts or Chart.js
- **Data:** Mixpanel Data Export API
- **Deployment:** Heroku (later) or Vercel

## Mixpanel Credentials
```
Project Token: e9b431147b591163571b62d2a07ab534
API Secret: 2f709094c12dc28d2ae69a570bec28df
```

Store these in `.env.local`:
```
MIXPANEL_API_SECRET=2f709094c12dc28d2ae69a570bec28df
MIXPANEL_PROJECT_TOKEN=e9b431147b591163571b62d2a07ab534
```

## Mixpanel API
Use the Data Export API with Basic Auth (API Secret as username, empty password):
```bash
curl -u "API_SECRET:" "https://data.mixpanel.com/api/2.0/export?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD"
```

Returns newline-delimited JSON (one event per line).

## Available Events (Current)
From iOS app (no web events yet):

| Event | Count | Description |
|-------|-------|-------------|
| Search Performed | 491 | User performed a search |
| Search | 477 | Search initiated |
| $ae_session | 395 | Automatic session tracking |
| Tab View | 304 | User viewed a tab |
| Onboarding | 189 | Onboarding flow events |
| Paywall Viewed | 175 | User saw paywall |
| Subscription View | 152 | Subscription screen viewed |
| Plan Selected | 131 | User selected a plan |
| SignUp | 115 | User signed up |
| Page Viewed | 74 | Page view events |
| $ae_first_open | 35 | First app open |
| Notes | 24 | Notes feature used |
| $ae_updated | 23 | App updated |
| AISelection | 22 | AI model selection |
| Purchase Initiated | 20 | Purchase flow started |
| Memory Management Viewed | 19 | Memory settings viewed |
| Documents | 16 | Documents feature used |
| Gemini Image Onboarding | 15 | Image gen onboarding |
| Purchase Failed | 12 | Purchase failed |
| Image Generation | 12 | Image generated |
| Try For Free Clicked | 10 | CTA clicked |
| Model Switch Image ID Clear | 10 | Model switch |
| Manage Subscription | 9 | Subscription management |
| Images | 9 | Images feature |
| Maps | 6 | Maps feature |
| Keyboard Shortcut Used | 4 | Keyboard shortcuts |
| AI Memory | 2 | AI memory feature |

## Key Event Properties
- **Platform:** `platform` (iOS, web)
- **Device:** `$model`, `$os`, `$os_version`, `$manufacturer`
- **Location:** `$city`, `$region`, `mp_country_code`
- **Search:** `model_used`, `search_mode`, `has_context`
- **Subscription:** `plan_type`, `price`, `product_id`, `has_trial`, `source`
- **Session:** `$ae_session_length` (in seconds)

## Dashboard Pages

### 1. Overview (Home)
- **Total Users** (unique distinct_ids) with trend
- **Total Sessions** ($ae_session count) with trend
- **Total Searches** (Search Performed count) with trend
- **Conversion Rate** (SignUp / total users)
- **Date range selector** (7d, 30d, 90d, custom)

### 2. User Activity
- **Daily Active Users (DAU)** line chart
- **Weekly Active Users (WAU)** line chart  
- **Monthly Active Users (MAU)** line chart
- **Session Duration Distribution** histogram
- **Sessions per User** distribution
- **Geographic breakdown** (table or map)

### 3. Search Analytics
- **Searches over time** (line chart)
- **Search modes breakdown** (Auto vs other) - pie chart
- **Models used** (gpt-5-mini, etc.) - bar chart
- **Searches with context vs without** - pie chart
- **Top search times** (hour of day heatmap)

### 4. Subscription Funnel
- **Funnel visualization:**
  - Paywall Viewed → Plan Selected → Purchase Initiated → Purchase Completed
- **Conversion rates** between each step
- **Revenue by plan type** (weekly, monthly, annual)
- **Trial conversion rate**
- **Failed purchases** with error breakdown
- **Paywall sources** (where users hit the paywall)

### 5. Feature Usage
- **Feature usage breakdown** (Tab View, Notes, Documents, Images, Maps, AI Memory)
- **Feature adoption over time**
- **Feature usage by user segment**

### 6. Onboarding
- **Onboarding completion funnel**
- **First open → SignUp conversion**
- **Drop-off analysis**

## UI/UX Requirements
- **Clean, modern design** (dark mode preferred, light mode optional)
- **Responsive** (works on desktop and mobile)
- **Fast loading** with loading states
- **Date range picker** on every page
- **Export to CSV** option for tables
- **Auto-refresh** every 5 minutes (optional toggle)

## API Routes (Next.js)
Create server-side API routes to proxy Mixpanel requests (keeps secret secure):

```
/api/events — fetch raw events with date range
/api/metrics/overview — aggregated overview stats
/api/metrics/users — user activity metrics
/api/metrics/searches — search analytics
/api/metrics/funnel — subscription funnel data
/api/metrics/features — feature usage data
```

## Data Caching
- Cache Mixpanel responses for 5 minutes (use `unstable_cache` or Redis)
- Show "last updated" timestamp on dashboard

## Authentication (Phase 2)
For now, no auth required. Future: add simple password protection or NextAuth.

## File Structure
```
chunk-analytics/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx (overview)
│   │   ├── users/page.tsx
│   │   ├── searches/page.tsx
│   │   ├── subscriptions/page.tsx
│   │   ├── features/page.tsx
│   │   ├── onboarding/page.tsx
│   │   └── api/
│   │       ├── events/route.ts
│   │       └── metrics/
│   │           ├── overview/route.ts
│   │           ├── users/route.ts
│   │           ├── searches/route.ts
│   │           ├── funnel/route.ts
│   │           └── features/route.ts
│   ├── components/
│   │   ├── charts/
│   │   ├── cards/
│   │   ├── layout/
│   │   └── ui/
│   ├── lib/
│   │   ├── mixpanel.ts (API client)
│   │   └── utils.ts
│   └── types/
│       └── mixpanel.ts
├── .env.local
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## Implementation Order
1. Set up Next.js project with Tailwind
2. Create Mixpanel API client (`lib/mixpanel.ts`)
3. Build API routes for data fetching
4. Create reusable chart components
5. Build Overview page
6. Build remaining pages
7. Add date range selector
8. Polish UI and add loading states
9. Test and deploy

## Notes
- **Web events:** Currently no web events in Mixpanel. May need to instrument chunk-web separately.
- **Rate limits:** Mixpanel has rate limits; implement caching to avoid hitting them.
- **Timezone:** Store timestamps in UTC, display in user's local timezone.

## Success Criteria
- Dashboard loads in < 2 seconds
- All metrics update when date range changes
- Charts are interactive (hover for details)
- Mobile-responsive layout
- Clean, professional appearance
