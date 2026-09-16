"""Read-only probe of RevenueCat's overview metrics endpoint.

The dashboard falls back to its own derived MRR whenever this call fails, and
the fallback is deliberately silent so a dead API never blanks the page. This
prints exactly what RevenueCat answers, so the reason is visible.

Prints no secrets — only whether each variable is set, and the key's prefix.

    heroku run -a cerebral-analytics python probe_revenuecat_metrics.py
"""

import json
import os
import sys
from urllib.parse import quote

import httpx

sys.path.insert(0, ".")

BASE = "https://api.revenuecat.com/v2"


def main():
    api_key = os.environ.get("REVENUECAT_SECRET_API_KEY", "")
    project_id = os.environ.get("REVENUECAT_PROJECT_ID", "")

    print("configuration")
    print(f"  REVENUECAT_SECRET_API_KEY  {'set' if api_key else 'MISSING'}"
          f"{'  prefix=' + api_key[:8] + '…' if api_key else ''}")
    print(f"  REVENUECAT_PROJECT_ID      {project_id or 'MISSING'}")
    if not api_key or not project_id:
        print("\nBoth are required. Copy them from the cerebral app if absent.")
        return 1

    headers = {"Authorization": f"Bearer {api_key}"}
    encoded = quote(project_id, safe="")

    for label, url in (
        ("overview metrics", f"{BASE}/projects/{encoded}/metrics/overview?currency=USD"),
        ("customers (scope sanity check)", f"{BASE}/projects/{encoded}/customers?limit=1"),
    ):
        print(f"\n{label}")
        print(f"  GET {url.replace(project_id, '<project>')}")
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(url, headers=headers)
        except Exception as exc:
            print(f"  request failed: {exc}")
            continue

        print(f"  HTTP {response.status_code}")
        if response.status_code != 200:
            print(f"  body: {response.text[:400]}")
            if response.status_code == 403:
                print("  → the API key lacks this endpoint's scope "
                      "(charts_metrics:overview:read). Regenerate it in the "
                      "RevenueCat dashboard with that permission enabled.")
            continue

        if "overview" not in url:
            print("  reachable — authentication and project id are correct")
            continue

        payload = response.json() or {}
        metrics = payload.get("metrics") or []
        print(f"  currency: {payload.get('currency')}")
        print(f"  {len(metrics)} metric(s) returned:")
        for entry in metrics:
            print(f"    {str(entry.get('id')):<28} "
                  f"{str(entry.get('value')):<14} "
                  f"unit={entry.get('unit')!s:<4} {entry.get('name')}")
        if not metrics:
            print(f"  raw: {json.dumps(payload)[:400]}")

        # Confirm the ids the dashboard looks for are actually present.
        import analytics_api as A

        ids = {str(e.get("id") or "").lower() for e in metrics}
        for label_, candidates in (("MRR", A.RC_MRR_METRIC_IDS),
                                   ("subscribers", A.RC_SUBSCRIBER_METRIC_IDS)):
            hit = next((c for c in candidates if c in ids), None)
            print(f"  {label_} id: {hit or 'NO MATCH — dashboard will fall back'}"
                  f"{'' if hit else ' (tried ' + ', '.join(candidates) + ')'}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
