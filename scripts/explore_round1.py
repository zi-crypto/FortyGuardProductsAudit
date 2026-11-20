#!/usr/bin/env python3
"""Round 1 exploration: auth matrix, credit ledger, docs example, MCP catalog.

Records every request/response pair (status, timing, selected headers, body)
to evidence/round1/. The API key is read from the environment and never
written to any output file.
"""
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests

BASE = "https://api.fortyguard.com"
MCP = "https://tos-mcp.app.fortyguard.com/mcp"
KEY = os.environ.get("FORTYGUARD_API_KEY", "")
OUT = Path("evidence/round1")
OUT.mkdir(parents=True, exist_ok=True)

if not KEY:
    sys.exit("FORTYGUARD_API_KEY not set")

RECORDS = []


@dataclass
class Probe:
    name: str
    method: str
    url: str
    status: int
    ms: float
    body: object = None
    headers: dict = field(default_factory=dict)
    note: str = ""


def scrub(d):
    """Remove anything that could carry the key."""
    return {k: v for k, v in d.items() if k.lower() not in ("authorization", "api-key")}


def call(name, method, url, *, headers=None, json_body=None, timeout=90, raw=False):
    h = dict(headers or {})
    t0 = time.perf_counter()
    try:
        r = requests.request(method, url, headers=h, json=json_body, timeout=timeout)
        dt = (time.perf_counter() - t0) * 1000
        text = r.text
        if raw:
            body = text[:4000]
        else:
            try:
                body = r.json()
            except Exception:
                body = text[:4000]
        p = Probe(
            name=name,
            method=method,
            url=url.replace(BASE, "").replace(MCP, "/mcp"),
            status=r.status_code,
            ms=round(dt, 1),
            body=body,
            headers={
                k: v
                for k, v in r.headers.items()
                if k.lower()
                in (
                    "content-type",
                    "content-length",
                    "www-authenticate",
                    "retry-after",
                    "x-ratelimit-limit",
                    "x-ratelimit-remaining",
                    "ratelimit-limit",
                    "access-control-allow-origin",
                    "access-control-allow-headers",
                    "server",
                    "cache-control",
                    "x-envoy-upstream-service-time",
                    "location",
                )
            },
        )
        RECORDS.append(p)
        return p
    except Exception as e:
        dt = (time.perf_counter() - t0) * 1000
        p = Probe(name, method, url, -1, round(dt, 1), body=f"EXCEPTION: {e}")
        RECORDS.append(p)
        return p


def show(p, limit=500):
    body = p.body
    s = json.dumps(body, indent=2) if not isinstance(body, str) else body
    if len(s) > limit:
        s = s[:limit] + f"\n… [{len(s)} chars total]"
    print(f"\n[{p.status}] {p.name}  ({p.ms} ms)  {p.method} {p.url}")
    if p.headers:
        print("  headers:", json.dumps(p.headers))
    print("  " + s.replace("\n", "\n  "))


# ---------------------------------------------------------------- credit ledger
print("=" * 70)
print("A. CREDIT LEDGER / KEY IDENTITY")
print("=" * 70)

credit_endpoints = [
    ("POST", "/v1/system/fetch-api-key-usage"),
    ("POST", "/v1/system/fetch-api-key-custom-usage"),
    ("GET", "/v1/system/fetch-api-key-usage"),
]
usage = None
for method, path in credit_endpoints:
    p = call(f"credits {method} {path}", method, BASE + path,
             headers={"api-key": KEY, "Content-Type": "application/json"}, json_body={})
    show(p, 900)
    if p.status == 200 and usage is None:
        usage = p.body

Path("evidence/round1/credits_before.json").write_text(json.dumps(usage, indent=2))

# ---------------------------------------------------------------- auth negatives
print("\n" + "=" * 70)
print("B. AUTH MATRIX (401/403 discrimination)")
print("=" * 70)

show(call("no key at all", "GET", BASE + "/v1/status/abc"))
show(call("empty api-key header", "GET", BASE + "/v1/status/abc", headers={"api-key": ""}))
show(call("invalid key", "GET", BASE + "/v1/status/abc", headers={"api-key": "fg_not_a_real_key"}))
show(call("wrong header name (Authorization Bearer)", "GET", BASE + "/v1/status/abc",
          headers={"Authorization": f"Bearer {KEY}"}))
show(call("key in query string", "GET", BASE + f"/v1/status/abc?api-key={KEY}"))
show(call("lowercase header (api_key)", "GET", BASE + "/v1/status/abc", headers={"api_key": KEY}))

# ---------------------------------------------------------------- CORS with key
print("\n" + "=" * 70)
print("C. CORS PREFLIGHT WITH VALID KEY")
print("=" * 70)
show(call("OPTIONS preflight", "OPTIONS", BASE + "/v1/heatmap",
          headers={"Origin": "https://example.com",
                   "Access-Control-Request-Method": "POST",
                   "Access-Control-Request-Headers": "api-key,content-type"}))

# ---------------------------------------------------------------- docs example
print("\n" + "=" * 70)
print("D. DOCS QUICKSTART EXAMPLE, VERBATIM (NYC)")
print("=" * 70)
# Copied exactly from /docs/quickstart: FeatureCollection, filter_type 1, granularity 100
docs_payload = {
    "polygon_aoi": {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-74.0170, 40.7050], [-74.0030, 40.7050],
                        [-74.0030, 40.7180], [-74.0170, 40.7180],
                        [-74.0170, 40.7050],
                    ]],
                },
            }
        ],
    },
    "date_time": {"start_date": "2024-07-15", "start_time": "14:00", "filter_type": 1},
    "granularity": 100,
}
p = call("heatmap: quickstart payload", "POST", BASE + "/v1/heatmap",
         headers={"api-key": KEY, "Content-Type": "application/json"}, json_body=docs_payload)
show(p, 900)

activity_id = None
if isinstance(p.body, dict):
    d = p.body.get("data") or {}
    activity_id = d.get("activity_id") or d.get("id") or p.body.get("activity_id")
print("\nactivity_id:", activity_id)
Path("evidence/round1/heatmap_activity_id.txt").write_text(str(activity_id))

# ---------------------------------------------------------------- polling
print("\n" + "=" * 70)
print("E. STATUS POLLING (latency to completion, and 404 semantics)")
print("=" * 70)
if activity_id:
    polls = []
    for i in range(12):
        q = call(f"status poll #{i+1}", "GET", f"{BASE}/v1/status/{activity_id}",
                 headers={"api-key": KEY}, timeout=60)
        st = None
        if isinstance(q.body, dict):
            st = (q.body.get("data") or {}).get("status")
        polls.append({"n": i + 1, "status": q.status, "state": st, "ms": q.ms})
        print(f"  poll {i+1}: http={q.status} state={st} {q.ms} ms")
        if st in ("Completed", "Failed"):
            break
        time.sleep(3)

    # immediately-after-submit 404 probe uses a fresh pending id if available
    Path("evidence/round1/polls.json").write_text(json.dumps(polls, indent=2))

print("\n" + "=" * 70)
print("F. 404 vs 500 DISCRIMINATION")
print("=" * 70)
show(call("unknown activity id", "GET", BASE + "/v1/status/00000000-0000-0000-0000-000000000000",
          headers={"api-key": KEY}))
show(call("malformed activity id", "GET", BASE + "/v1/status/not-a-uuid",
          headers={"api-key": KEY}))

# ---------------------------------------------------------------- env_params
print("\n" + "=" * 70)
print("G. ENV_PARAMS — MCP QUICKSTART EXAMPLE (PHOENIX)")
print("=" * 70)
show(call("env_params phoenix", "POST", BASE + "/v1/env_params",
          headers={"api-key": KEY, "Content-Type": "application/json"},
          json_body={
              "latitude": 33.4484, "longitude": -112.074, "temperature": 35,
              "date_time": {"start_date": "2025-09-20", "start_time": "12:00", "filter_type": 1},
          }), 1400)

# ---------------------------------------------------------------- MCP catalog
print("\n" + "=" * 70)
print("H. MCP: initialize + tools/list (Bearer key per docs)")
print("=" * 70)
mcp_headers = {
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                   "clientInfo": {"name": "fortyguard-eval", "version": "0.1"}}}
p = call("MCP initialize", "POST", MCP, headers=mcp_headers, json_body=init, raw=True)
show(p, 800)

session = p.headers.get("mcp-session-id") if isinstance(p.headers, dict) else None
print("\nmcp-session-id present:", bool(session))

tl_headers = dict(mcp_headers)
if session:
    tl_headers["mcp-session-id"] = session
p2 = call("MCP tools/list", "POST", MCP, headers=tl_headers,
          json_body={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, raw=True)
show(p2, 3000)

# ---------------------------------------------------------------- save
payload = [p.__dict__ for p in RECORDS]
Path("evidence/round1/records.json").write_text(json.dumps(payload, indent=2))
print(f"\n\nSaved {len(RECORDS)} records to evidence/round1/records.json")
print("CREDITS BEFORE:", json.dumps(usage)[:400])
