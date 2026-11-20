#!/usr/bin/env python3
"""Round 5: dashboard-api (session-cookie surface) probe harness.

Read-only by design: no POST/PATCH that could create maps, routes, monitors or
consume credits. Auth material is never printed; only cookie names/lengths and
Set-Cookie attribute flags are recorded.

Usage: python3 scripts/explore_dashboard.py
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://dashboard-api.apps.fortyguard.com"
ORIGIN = "https://dashboard.fortyguard.com"
COOKIE_FILE = "current_session_cookies/current_session_cookies.json"
OUT_DIR = "evidence/round5"
MAX_BODY_BYTES = 200_000
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/157.0.0.0 Safari/537.36")


def load_cookies():
    with open(COOKIE_FILE) as fh:
        raw = json.load(fh)
    return {c["name"]: c["value"] for c in raw}, raw


def cookie_header(jar):
    return "; ".join(f"{k}={v}" for k, v in jar.items())


def call(path, jar, method="GET", origin=ORIGIN, extra_headers=None):
    url = BASE + path
    headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Origin": origin,
        "Referer": ORIGIN + "/",
    }
    if jar:
        headers["Cookie"] = cookie_header(jar)
    headers.update(extra_headers or {})
    req = urllib.request.Request(url, method=method, headers=headers)
    t0 = time.time()
    rec = {"method": method, "path": path, "origin": origin}
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read()
            rec["status"] = resp.status
            rec["headers"] = dict(resp.headers.items())
    except urllib.error.HTTPError as exc:
        body = exc.read()
        rec["status"] = exc.code
        rec["headers"] = dict(exc.headers.items())
    except Exception as exc:  # network/timeout
        rec["error"] = f"{type(exc).__name__}: {exc}"
        rec["elapsed_s"] = round(time.time() - t0, 3)
        return rec, None
    rec["elapsed_s"] = round(time.time() - t0, 3)
    text = body.decode("utf-8", "replace")
    rec["bytes"] = len(body)
    # A 26 MB GeoJSON body must not be copied into the evidence artifact; record
    # its size and shape instead so the file stays reviewable.
    if len(body) > MAX_BODY_BYTES:
        try:
            big = json.loads(text)
            rec["json_omitted"] = {
                "reason": f"body >{MAX_BODY_BYTES} bytes",
                "top_keys": list(big.keys())[:10] if isinstance(big, dict) else [],
                "data_keys": (list((big.get("data") or {}).keys())[:15]
                              if isinstance(big.get("data"), dict) else None),
            }
        except ValueError:
            rec["text_head"] = text[:300]
        rec["json"] = {"_omitted": True, "bytes": len(body)}
    else:
        try:
            rec["json"] = json.loads(text)
        except ValueError:
            rec["text_head"] = text[:300]

    # Never persist auth material.
    lowered = {k.lower(): v for k, v in rec["headers"].items()}
    if "set-cookie" in lowered:
        names = []
        for chunk in str(lowered["set-cookie"]).split(","):
            attr = chunk.split(";")[0].split("=")[0].strip()
            if attr:
                names.append({
                    "name": attr,
                    "secure": "secure" in chunk.lower(),
                    "httponly": "httponly" in chunk.lower(),
                    "samesite": next((p.strip() for p in chunk.split(";")
                                      if "samesite" in p.lower()), None),
                })
        rec["set_cookie_attrs"] = names
        rec["headers"].pop("Set-Cookie", None)
        rec["headers"].pop("set-cookie", None)
    return rec, rec.get("json")


def summarize(rec):
    js = rec.get("json") or {}
    msg = js.get("message") if isinstance(js, dict) else None
    det = (js.get("details") or {}).get("message") if isinstance(js, dict) else None
    return (f"{rec.get('status','ERR')} {rec.get('elapsed_s')}s "
            f"{rec.get('bytes','-')}B msg={msg!r} detail={det!r}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    jar, raw = load_cookies()
    print(f"cookies: {[(c['name'], len(str(c['value']))) for c in raw]}")

    records = []

    # 1. Identity + security headers baseline (with and without session).
    rec, js = call("/auth/verify-access?initial=true", jar)
    rec["label"] = "verify-access (session)"
    data = (js or {}).get("data") or {}
    account_id = data.get("account_id")
    demo = data.get("demo_heatmap_id")
    print("verify-access:", summarize(rec))
    h = {k.lower(): v for k, v in rec["headers"].items()}
    print("  security headers:", {k: h.get(k) for k in
          ("strict-transport-security", "content-security-policy",
           "x-content-type-options", "x-frame-options",
           "referrer-policy", "permissions-policy",
           "x-ratelimit-limit", "server", "access-control-allow-credential")})
    print("  account:", account_id, "role:", data.get("role"),
          "features:", data.get("allowed_features"),
          "settings:", data.get("user_settings"))
    records.append(rec)

    rec, _ = call("/auth/verify-access?initial=true", None)
    rec["label"] = "verify-access (no session)"
    print("no-session:", summarize(rec))
    records.append(rec)

    # 2. CORS: foreign origin must not be reflected.
    rec, _ = call("/auth/verify-access?initial=true", jar, origin="https://evil.example")
    rec["label"] = "CORS foreign origin"
    h = {k.lower(): v for k, v in rec["headers"].items()}
    rec["cors_allow_origin"] = h.get("access-control-allow-origin")
    rec["cors_allow_credentials"] = h.get("access-control-allow-credentials")
    print("cors foreign:", summarize(rec), "ACAO:", rec["cors_allow_origin"])
    records.append(rec)

    # 3. Tampered signature must fail closed.
    bad = dict(jar)
    tok = bad["session_token"]
    bad["session_token"] = tok[:-6] + ("aaaaaa" if not tok.endswith("aaaaaa") else "bbbbbb")
    rec, _ = call("/auth/verify-access?initial=true", bad)
    rec["label"] = "tampered token"
    print("tampered:", summarize(rec))
    records.append(rec)

    # 4. Quota / usage counters.
    for path, label in [
        ("/activity/user-stats", "user-stats"),
        ("/auth/subscribed-states", "subscribed-states"),
        ("/monitoring/monitors", "monitors list"),
    ]:
        rec, js = call(path, jar)
        rec["label"] = label
        print(f"{label}:", summarize(rec))
        if label == "user-stats" and js:
            print("  ", json.dumps(js.get("data"), indent=2)[:600])
        if label == "subscribed-states" and js:
            states = (js.get("data") or {}).get("states")
            n = states.count('"id"') if isinstance(states, str) else None
            print("  states payload bytes:", len(states) if isinstance(states, str) else None,
                  "features:", n)
        records.append(rec)

    # 5. Credits as shown in the dashboard vs the public API ledger (960,280).
    if account_id:
        q = urllib.parse.quote(account_id, safe="")
        rec, js = call(f"/activity/get-credits?account-id={q}", jar)
        rec["label"] = "get-credits (own account)"
        print("get-credits:", summarize(rec), "->", json.dumps(js)[:300])
        records.append(rec)

        rec, js = call("/activity/get-credits?account-id=acc%23somebodyelse", jar)
        rec["label"] = "get-credits (foreign account-id)"
        print("get-credits foreign:", summarize(rec), "->", json.dumps(js)[:300])
        records.append(rec)

    # 6. Known-good UUIDs from earlier API rounds -> cross-surface visibility.
    known_activity = "a7cf1f81-99f4-41f3-8cb7-25e9674fa61d"  # heat_intelligence report
    known_heatmap = "cf30c0ac-2046-417a-acf8-4796b9ed9470"   # exceedance heatmap
    probes = [
        (f"/activity/{known_activity}", "activity detail (API-created report)"),
        (f"/heatmaps/{known_heatmap}", "heatmap detail (API-created)"),
        (f"/heatmaps/{demo}", "heatmap detail (demo_heatmap_id)") if demo else None,
        ("/heatmaps/00000000-0000-4000-8000-000000000000", "heatmap detail (random UUID)"),
        ("/activity/00000000-0000-4000-8000-000000000000", "activity detail (random UUID)"),
        ("/monitoring/alerts/00000000-0000-4000-8000-000000000000", "alerts (random monitor)"),
        (f"/heatmaps/{demo}/azure/map-stats", "map-stats GET (demo)") if demo else None,
    ]
    for probe in [p for p in probes if p]:
        path, label = probe
        rec, js = call(path, jar)
        rec["label"] = label
        print(f"{label}:", summarize(rec))
        if js:
            print("   keys:", list(js.keys())[:8],
                  "| data keys:", list((js.get("data") or {}).keys())[:12]
                  if isinstance(js.get("data"), dict) else type(js.get("data")).__name__)
        records.append(rec)

    # 7. Malformed input parity with the public API's 500-on-4xx pattern.
    for path in ["/heatmaps/heatmap?limit=5", "/heatmaps/%20", "/activity/user-stats?x=%00"]:
        rec, _ = call(path, jar)
        rec["label"] = f"malformed {path}"
        print("malformed:", path, summarize(rec))
        records.append(rec)

    out = os.path.join(OUT_DIR, "dashboard_api.json")
    with open(out, "w") as fh:
        json.dump({"base": BASE, "origin": ORIGIN,
                   "captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "records": records}, fh, indent=2)
    print(f"\nwrote {out} ({len(records)} records)")


if __name__ == "__main__":
    main()
