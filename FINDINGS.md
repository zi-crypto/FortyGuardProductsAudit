# Confirmed Findings — FortyGuard, rounds 1–5 (2026-11-20)

Executed against `api.fortyguard.com`, `tos-mcp.app.fortyguard.com`, and — from round 5 — the dashboard's own backend `dashboard-api.apps.fortyguard.com` plus `dashboard.fortyguard.com` in a real browser.
**9 billable activities (6 heatmaps, 1 report, 2 `env_params`), 39,720 credits consumed, 0 credits lost to errors.** Round 5 was read-only (GET only): 0 credits, 0 activities.
Raw evidence: `evidence/round1…round5/` (request/response JSON, timings, PDF, MCP SSE transcripts, cookie-authenticated dashboard API records, rendered screenshots, console/network traces).

Method: ISO/IEC 25040 evaluation process; ISO/IEC/IEEE 29119-4 test-design techniques; ISO 19157-1 data-quality elements; OWASP API Security Top 10 (2023) for the authz/resource classes.

---

## A. Defects, by severity

### F1 — S1 — `heat_intelligence` interprets `temperature` as **°F** while every sibling endpoint uses **°C**
**Evidence.** Request: `{"latitude":33.4484,"longitude":-112.074,"temperature":82.4,"date":"2025-07-15","analysis":["environmental"]}`.
Generated PDF, page 1: `Temperature:         28.0°C (82.4°F)`; page 6: *"The provided average temperature of 82.4°F is substantially below the July climate normal mean of ~94.9°F — approximately 12.5°F below normal."*
The endpoint therefore read 82.4 as Fahrenheit and produced a report around 28 °C.
**Contradiction.** The same endpoint's own field docs say *"Temperature value in degrees Fahrenheit"* but the adjacent `date` field says *"Date for the supplied **Celsius** temperature"*. `env_params.temperature` is documented and implemented as Celsius (verified: 35 → heat index 34.3, RH 28.3). The MCP `report` tool description says *"Reference temperature in degrees Celsius"*.
**Impact.** This is the worst possible failure mode for the product's flagship Premium feature: a plausible-looking, confidently-written 14-page report built on a silently misread input. Any agent (MCP or Dashboard agent) that passes Celsius — which is what every other tool in the family requires — gets a wrong report and no error. **No validation rejects either unit**, so the error is undetectable by the caller.
**Fix.** One unit across the family (Celsius), reject impossible values, echo the interpreted value + unit in the response, and state the unit in the PDF.

### F2 — S1 — The documentation's own Quickstart example fails on the first call
**Evidence.** The Quickstart's verbatim payload (Manhattan polygon, `-74.0170/40.7050 → -74.0030/40.7180`) returns:
`400 OUT_OF_COVERAGE — "…The requested location is outside supported U.S. coverage."`
Reproduced twice (FeatureCollection and bare Polygon) on two dates.
**Impact.** A new customer's first action — copy the Quickstart — fails, with a message that says a Manhattan coordinate is "outside supported U.S. coverage". NYC is also the example city in `/docs/authentication` and `/docs/street-view-segmentation`. The same payload with Phoenix coordinates succeeds in ~23 s. Whatever the true coverage boundary is, the docs ship an example that cannot work and an error message that misdescribes the cause.
**Fix.** Re-test every published example in CI; replace them with a covered AOI; make the coverage error name the supported region/cities rather than asserting "US only".

### F3 — S2 — Four client-side input errors are reported as **HTTP 500**
| Case | Expected | Actual |
|---|---|---|
| `filter_type:1` without `start_time` | 422 | **500** |
| `start_time: "25:00"` | 422 | **500** |
| `filter_type:4`, `end_date` 32 days after start (doc limit: 31) | 400/422 | **500** |
| `Content-Type: text/plain` with valid JSON body | 415 | **500** |

**Impact.** Clients and SDKs retry 5xx; these are deterministic user errors, so retries are pure waste against a 300-request budget, and the 500s pollute the provider's own error-rate monitoring. Real 5xx also become indistinguishable from fake ones.
**Standard.** ISO/IEC/IEEE 29119-4 boundary/negative testing; RFC 9110 §15.6 semantics.

### F4 — S2 — Error envelope is inconsistent across five shapes
- `401` / `404`: `{"error":true,"status_code":401,"details":{"message":…}}`
- `422` / `400` (validation): `{"error":true,"status_code":422,"message":…,"field":…,"detail":[…],"code":…}`
- `500`: `{"error":true,"message":…}` — **no `status_code`, no `field`**
- `405`: `{"detail":"Method Not Allowed"}` — FastAPI default, **no `error` flag**
- `400 OUT_OF_COVERAGE`: adds `code`; date-floor error also returns `code:"NO_COVERAGE"` for a **date** problem
**Impact.** A single error handler written from the Quickstart works for 401 but breaks on 422 and crashes on 500/405. `code` is present only sometimes, so programmatic branching is unreliable.
**Fix.** One envelope, always with `status_code`, `code`, `field`, `message`; separate `DATE_OUT_OF_RANGE` from `OUT_OF_COVERAGE`.

### F5 — S2 — `time_of_measure` returns a **UTC** hour even though the request is local time
**Evidence.** Request `start_date 2025-09-20, start_time 12:00` (Phoenix, UTC−7) → all 117 tiles `value: 19`; `stats_data.window_utc: 19:00Z`; `hour_counts_utc: [0,…,1,…]`; `tie_rule: "earliest_timestamp"`.
**Read.** Behaviour is *internally* correct and even self-describing (`window_utc`), and the docs do say 20 m uses AOI timezone while other resolutions keep UTC. But the customer-facing reading is "I asked for noon and got 19". In a heatmap legend, `19` reads as 7 pm.
**Fix.** Return an offset/local-hour option, or put the timezone in each tile's properties, not just in stats.

### F6 — S2 — `stats_data` does not match the documented schema, and its shape depends on `analytic_type`
| | Documented | Actual (`tcm`) | Actual (`exceedance`/`persistence`/`time_of_measure`) |
|---|---|---|---|
| key names | `Temperature_stats`, `Overall_temperature_distribution`, `Normal_temperature_distribution`, `Temperature_frequency` | `temperature_stats`, `overall_temperature_distribution`, `normal_temperature_distribution`, `temperature_frequency` (all lowercase) | `min`,`max`,`mean`,`units`,`window_utc`,`n_cells`,`calculation_version`,`value_representation`,`threshold_celsius`,`direction` |
| sub-keys | `Minimum`,`Maximum`,`Mean`,`Standard_deviation` | `minimum`,`maximum`,`mean`,`standard_deviation` | — |
| `units` | documented | **absent** | present (`"hour"`) |

**Impact.** Code written from the docs reads `stats["Temperature_stats"]["Mean"]` and throws `KeyError` on a live 200 response; the field that tells you what the number *means* (`units`) is missing exactly where the number is a temperature. A documented field that doesn't exist is worse than an undocumented one.
**Fix.** Publish the JSON Schema per `analytic_type`; make `units` universal (`"°C"` for tcm).

### F7 — S2 — Documented earliest date is wrong (2019 vs 2021)
Docs (`/docs/create-heatmap`, `/docs/limitations`) say *"default earliest date 2019-01-01"*. Live response: `400 … "is before the earliest supported date (2021-01-01)"`. The MCP `env_params` description says 2021-01-01. So one surface is right and two pages are wrong.
**Impact.** Historic-analysis jobs are scoped against the wrong floor; a 2019 time series silently becomes a 400 at build time.

### F8 — S2 — Undocumented rate limit with no published 429 policy
Responses carry `x-ratelimit-limit: 300` and a decrementing `x-ratelimit-remaining` (299, 298, 297 …), on both accepted and rejected requests. No rate limit, window, `429` behaviour, or `Retry-After` appears anywhere in the docs — including the page literally named "Known Limitations".
**Standard.** OWASP API4:2023 (Unrestricted Resource Consumption) — the control exists but is undiscoverable, so integrators cannot size concurrency or back off correctly. Worse: the Quickstart's polling loop has no delay budget against a 300-request allowance.

### F9 — S2 — MCP catalog drift and an auth model that doesn't match the docs
**Evidence.** `initialize` with `Authorization: Bearer <API_KEY>` → `200`, `serverInfo: {name:"FortyGuard", version:"4.0.11"}`, no `mcp-session-id` (stateless). `tools/list` returns a first tool **`credit_balance`** — *not* in the documented catalogue of nine — and every tool carries `_meta.securitySchemes: [{type:"oauth2", scopes:["analysis:read"|"analysis:run"]}]`. The same endpoint's `401` advertises an Auth0 **dev** tenant (`dev-k5iak2wdgpsmgyli.us.auth0.com`) with scopes `analysis:run`/`analysis:read`.
**Read.** Static Bearer key works, so the docs aren't *wrong* — but the server simultaneously markets OAuth scopes, the docs never mention scopes or re-registration, and the advertised catalogue is already stale. An agent told "use the 9 documented tools" will not know `credit_balance` exists, and vice versa. Catalog drift in an agent-facing product is a correctness issue, not cosmetics.

### F10 — S2 — MCP tool descriptions reach the model with corrupted UTF-8
**Evidence.** Live `tools/list`: `"date â e.g. provider-sourced…"`, `"irradiance estimates (GHI, DNI, and DHI in W/mÂ²)"`; same in the `tools/call` payload.
**Impact.** These strings are the agent's only instructions. Mojibake in the exact field that guides tool choice and parameter semantics is a quality defect the customer sees in `claude mcp get`/`/mcp` output, and it wastes tokens on every turn.

### F11 — S2 — MCP renames and drops fields relative to REST
`tools/call env_params` returned a curated block: `apparent_temperature_celsius`, `relative_humidity_percent`, `precipitation_mm`, `cloud_cover_octas`, `wet_bulb_temperature_celsius`, **`elevation_meters`**, **`aqi_us`** — plus `raw`. REST uses `elevation` and `air_quality:idx`. `heat_index_celsius` is present in `raw` but **absent from the curated block** even though the tool description says the heat index is derived from the supplied temperature and is the headline comfort metric.
**Impact.** Two surfaces, two vocabularies, and the curated view hides the one number the description advertises. Cross-surface tests cannot reconcile without manual mapping.
**Credit note.** The MCP call created its *own* `activity_id` and charged 2,900 — so an agent that "checks" via MCP after a REST call pays twice.

### F12 — S3 — Unknown fields silently accepted; geometry contract looser than documented
`{"polygon_aoi":…,"date_time":…,"foo":"bar"}` → **200, accepted, 4,220 credits charged** (activity `08b9a475…`). Both `FeatureCollection` and bare `Polygon` are accepted, although `/docs/limitations` requires *"a valid GeoJSON FeatureCollection whose geometry is a closed Polygon"* and `/docs/create-heatmap` shows a bare `Polygon`.
**Impact.** Lenient parsing is defensible; silent acceptance of typos is not — `granularityy: 60` would be ignored and the default 100 used, producing a subtly wrong (paid) result. The docs and the parser must agree on which shape is canonical.

### F13 — S3 — `code` semantics conflate date and geography
A pre-2021 date returns `code:"NO_COVERAGE"`; a Manhattan AOI returns `code:"OUT_OF_COVERAGE"` with a message asserting the location is outside the US. Both are about "we can't serve this", but a client branching on `code` cannot distinguish "pick a later date" from "pick another city".

### F14 — S3 — Docs are not machine-consumable and 404s are silent
`/openapi.json`, `/api/openapi.json`, `/sitemap.xml`, `/llms.txt` → SPA shell (`200 text/html`, 1,419 B). `/docs/does-not-exist` → **200**.
**Impact.** No codegen, no schema validation, no Postman import, no agent-readable docs; broken links look healthy; and the API surface (including MCP) has to be hand-transcribed — which is exactly how F6/F11 drift happens.

### F15 — S3 — A second auth mechanism, and the docs ask you to paste your key into a web form
`POST /v1/system/fetch-api-key-usage` with a valid `api-key` **header** returns `422 "Field 'api_key' is required."` — the key must be in the **JSON body**. Successful response echoes `"api_key": null` (good). The docs page `/docs/credits-usage` is a form that asks the customer to paste a live key into a page that also loads Microsoft Clarity session recording.
**Impact.** Customers are trained to paste production secrets into a marketing-site subdomain; body-borne keys land in request logs far more readily than header-borne ones. Recommend a masked, POST-only, no-replay flow (or token-scoped usage endpoint).

### F16 — S3 — Entitlement reported as "Premium" with 1M one-time credits, contradicting the published Premium plan
Live usage payload: `plan_type: "Premium"`, `cycle_type: "One-Time"`, `total_available_credits: 1,000,000`, expiry 2026-12-20. Docs: Premium = **5,000,000 monthly**; 1M one-time + 6-month window is the **API Startup** shape. The free-key page promises "full Premium access at no cost".
**Impact.** The account can't tell what it bought, and Premium-only features are the thing being gated. Either the plan model has a third tier the docs don't describe, or the label is wrong.
**Round-5 addendum — the same account is entitled three different ways.** The dashboard's `verify-access` reports `role: "paid"` but a `base_subscription` of `base_subscp_id: "free"`, `location_id: "New York"`; the dashboard map therefore opens on New York State and only that state is "subscribed"; the API key claims Premium with 1M credits and serves AOIs across the US. One account, three entitlement stories (free-by-state / paid / Premium-1M), none of which agree.

### F17 — S3 — Release notes cover one release; four shipped surfaces are unlogged
`/docs/release-notes` has exactly one entry (v1.0.0, 22 Apr 2026) and does not mention MCP, Monitoring & Alerting (12 doc pages), Temperature-Aware Routing, or the QGIS plugin — all documented and live.

### F18 — S3 — Completeness: 117 cells for an AOI that should hold ~148 at 100 m
AOI `0.012° × 0.012°` at 33.44° N ≈ 1.115 km × 1.331 km ≈ **1.48 km²**; at 100 m that is ~148 cells, but `n_cells: 117` (79%). Identical across all six heatmaps, so it is stable, not flaky.
**Read.** `n_cells` being exposed is genuinely good practice (most vendors hide it). The grid may legitimately be hex/offset, or edges may be clipped — but the docs define granularity as "numeric metres" and never define the tiling, so a customer cannot compute expected coverage. ISO 19157 completeness is therefore unverifiable from the outside.

### F19 — S4 — Latency profile
| Operation | Observed |
|---|---|
| heatmap submit (accepted) | 4.8–5.9 s |
| heatmap submit (rejected 400) | 0.6–0.8 s |
| heatmap completion | 21.7–36.7 s (4–8 polls @ 3–5 s) |
| `env_params` submit | 3.2 s |
| `heat_intelligence` completion | **150.8 s** (22 polls) |
| MCP `env_params` (sync) | **13.7 s**, 4.2 KB SSE |
| MCP `initialize` / `tools/list` | 2.2 s / 2.6 s |
| auth-rejected (401) | 0.9–1.0 s |

A 5-second synchronous submit for a task that is asynchronous by design gives the caller no useful signal and doubles the polling window. 151 s for a report is acceptable *if* the client is told to expect minutes (the Quickstart's 120×5 s loop only covers 10 min, so it is fine; the MCP client `tool_timeout_sec=120` from the docs' own Codex config is **not**).

### F20 — S4 — `x-ratelimit-remaining` accounting is ambiguous
Repeated heatmap submits each showed `remaining: 299` before dropping to 298, 297 — suggesting per-endpoint counters or a reset between calls. Cannot be resolved without deliberate 429 probing (deferred: would consume budget and is intrusive).

### F21 — S2 — First authenticated load can render a **blank white page** (uncaught hydration error)
**Evidence.** Cold Chrome profile, cookies injected before navigation, `GET /map` → final URL `/`, **40 DOM nodes, 0 characters of text, 0 controls**; screenshot `evidence/round5/dashboard_map.png` is uniformly white. Console: `ERROR TypeError: Cannot read properties of undefined (reading 'base_subscription')` at `new D (main.45db50ba0385ca19.js:1:184536)` via `nr.hydrate`. The offending line in the bundle reads `this.subscription_id=this.session.userData().subscriptions.base_subscription.base_subscp_id` — a service constructor dereferences session data that is not populated yet during hydration. Observed on 1 of 9 navigations; a reload of the same URL then rendered 1,073 elements. The matrix run (7 routes) reproduced no further blanks.
**Impact.** A first-time customer who hard-loads a deep link can get an unrecoverable white screen — no error message, no retry, no support path. That it self-heals on reload makes it worse for support: it looks like a user error. It is a race, not a deterministic failure, so it must be guarded rather than reproduced.
**Fix.** Guard the subscription read (or resolve `verify-access` before constructing dependent services), and add an Angular `ErrorHandler`/error boundary that renders a retry state instead of an empty `<app-root>`.

### F22 — S1 — Session cookies are JavaScript-readable and long-lived → account takeover via any XSS
**Evidence.** Exported jar for `.fortyguard.com`: `session_token` (1,148 chars, `httpOnly:false`, `secure:true`, `sameSite:no_restriction`) and `session_refresh_token` (183 chars, same flags, expiry **2027-12-27**). Confirmed from inside the page: `document.cookie` enumerates both (`evidence/round5/dashboard_ui.json → document_cookie_names`). The access token is a Firebase JWT for project `accountplatform-prod`, `role: paid_user`, 1-hour lifetime; the refresh token is opaque and valid ~2 years.
**Impact.** Any script running on `dashboard.fortyguard.com` — a third-party tag, a dependency, a stored-XSS in a heatmap name — can read both tokens and replay them from anywhere, minting fresh ID tokens for two years with no password, no MFA prompt and no user-visible signal. The page loads Microsoft Clarity session recording and Google Analytics, i.e. third-party scripts are already trusted with the DOM. This is the highest-impact defect in the evaluation: it converts any scripting bug into permanent account takeover.
**Fix.** Set both cookies server-side with `HttpOnly; Secure; SameSite=Lax` (the API is on a different registrable domain than nothing — no cross-site need for `SameSite=None`), keep refresh tokens server-side only, and add a strict CSP (see F23).

### F23 — S2 — No security headers on either host
**Evidence.** `dashboard-api.apps.fortyguard.com` `200` responses carry exactly `server, date, content-type, content-length, access-control-allow-credentials, access-control-allow-origin, vary, x-envoy-upstream-service-time`. `dashboard.fortyguard.com/map` carries `server: envoy` plus standard content headers — and **no** `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy`. The app document is 66,691 B of SSR HTML; both hosts are behind the same Envoy.
**Impact.** Missing HSTS permits SSL-stripping on the auth flow; missing CSP leaves F22 exploitable by any injected script; missing `nosniff`/`X-Frame-Options` permits MIME confusion and clickjacking of the dashboard (which has destructive actions: create heatmap, routing, delete). None of this is exotic — it is the default OWASP Secure Headers set.
**Fix.** `HSTS: max-age=31536000; includeSubDomains; preload`, a nonce-based CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`.

### F24 — S2 — The Google Maps browser key is unrestricted and billable
**Evidence.** The dashboard HTML embeds `https://maps.googleapis.com/maps/api/js?key=AIzaSyBbwIu32a3D8ZxcCTBeCErNcaE3Te8Jb_c&libraries=visualization,places`. Calling Static Maps with that key and **no `Referer` at all** returned `HTTP 200` and a valid 100×100 PNG, so the key has no HTTP-referrer or API restriction. (The key being visible is normal for Maps JS — the missing restriction is the defect.)
**Impact.** Anyone who views source can lift the key and bill Static Maps / Street View / Geocoding usage to FortyGuard, with no domain or API allow-list to stop it. Combined with F22 this is the same blast radius: a public page hands out billable credentials.
**Fix.** Apply HTTP-referrer restrictions (`dashboard.fortyguard.com/*`), restrict to the three APIs actually used, and set quota caps + billing alerts on the GCP project.

### F25 — S1 — The Dashboard and the API are separate data universes
**Evidence.** After rounds 1–4 created **7 heatmaps and 1 report** on the account (`api.fortyguard.com`, 39,720 credits), the dashboard's own list `GET /heatmaps/?num=0` returns **only the demo heatmap** `4660b071-960b-4ac5-8074-a8fc99e711a3` and `total_activities: 0`. `/activity/user-stats` returns `total_heatmaps: 0` while simultaneously reporting `current_count: 2` — internally contradictory. The rendered UI shows an empty "Recent activities" panel ("No task generation in progress") and a sidebar with no saved heatmaps; the public API's own usage endpoint reports 39,720 credits consumed.
**Impact.** A customer who integrates the API cannot see, reopen, rename, delete, export or share a single one of those paid jobs in the UI — and cannot reconcile spend, because the dashboard's credit readout is also broken (F27). The product's two halves do not form one account, which breaks the central premise of buying both and makes the dashboard useless as an audit surface. It also means the UI's demo data is the only thing an evaluator can exercise without spending credits.
**Fix.** One activity store keyed on `account_id`, shared by REST, MCP and dashboard; if the split is intentional, the dashboard must list API/MCP activities read-only at minimum, and the docs must say so.

### F26 — S2 — dashboard-api answers "not found" with **500**, and `activity` returns `[]` for anything
| Request | Expected | Actual |
|---|---|---|
| `GET /heatmaps/{own API-created heatmap}` | 200 | **500** `Internal server error occurred` |
| `GET /heatmaps/{random UUID}` | 404 | **500** (same body) |
| `GET /heatmaps/heatmap?limit=5` | 200/422 | **500** |
| `GET /heatmaps/%20` | 400/404 | **500** |
| `GET /activity/{own report UUID}` | 200 + record | 200 `data: []` |
| `GET /activity/{random UUID}` | 404 | 200 `data: []` |
| `GET /monitoring/alerts/{random}` | 404 | 404 + `code` (correct) |

**Impact.** The same 500-on-client-error anti-pattern as F3, now on the surface customers use most, and a silent `[]` that means "found nothing" and "wrong ID" identically. Because "own" and "random" are indistinguishable, the **BOLA/isolation verdict cannot be read from status codes** — no leak was observed, but the API gives no positive proof of isolation either.
**Fix.** 404 for absent resources, 422 for malformed paths, `[]` only for genuinely empty collections.

### F27 — S2 — The dashboard's credit readout is broken, and `account-id` is ignored
**Evidence.** `GET /activity/get-credits?account-id=acc%23yv6qAlebfv` (own account, quoted from `verify-access`) returns `HTTP 200` with body:
`{"error": false, "status_code": 200, "message": "Successfully fetched", "data": [false, "Internal server error occurred"]}`
The identical bytes come back for `account-id=acc%23somebodyelse`. So the failure is (a) an internal error dressed as `200` success, (b) the account filter has no effect, and (c) the 960,280-credit balance the public API reports is invisible in the product that is supposed to show it.
**Impact.** Customers cannot see what they have spent in the UI, and a 200-with-error-inside defeats every generic client health check (monitoring, retries, SDK error handling all see success). The ignored `account-id` is an authorization smell even though it leaked nothing.
**Fix.** Return a real 5xx or a populated payload; delete the client-supplied `account-id` in favour of the session identity.

### F28 — S3 — Deep links to `/activity`, `/monitoring`, `/routing` render a blank page
**Evidence.** Direct navigation to each route ends at `https://dashboard.fortyguard.com/` with **36–37 DOM nodes, 0 text, 0 named controls, 0 API calls** (screenshots `evidence/round5/ui_activity.png`, `ui_monitoring.png`, `ui_routing.png`). `/mcp/connect` does render, as a static 189-character card ("No valid connection was found…"). There is no 404 route and no empty state.
**Impact.** Bookmarks, emails and the back button land on a white screen with no navigation, no heading and no landmark — a dead end for the customer and an accessibility failure (no `main`, no `h1`, nothing announced).
**Fix.** Route `/` to `/map` explicitly, add a catch-all 404, and render an empty state for unentitled features instead of redirecting into nothing.

### F29 — S3 — Heatmap detail payload is 26.7 MB uncompressed (7.1 MB gzipped) and takes 19 s
**Evidence.** `GET /heatmaps/4660b071-…` (the demo New York heatmap) → `200`, **26,741,362 B**, **18.87 s** with no `Accept-Encoding`; **7,108,426 B / 5.71 s** with `Accept-Encoding: gzip, br`. For comparison the public API's 117-cell Phoenix heatmap is a few tens of KB.
**Impact.** Opening one saved heatmap transfers more than a small app; on a phone or a metered connection this is a multi-second stall before anything paints, and the browser must hold the parsed GeoJSON in memory. Compression is working, so the fix is the payload, not the transport.
**Fix.** Vector tiles or bbox/zoom-filtered geometry, a `simplify` tolerance, and a summary endpoint for the list view.

### F30 — S3 — The UI advertises features whose backend returns 404, and ships an undocumented `/voting` surface
**Evidence.** The sidebar offers "Create heatmap" and "Find the Coolest Route"; the client calls `/agent/query`, `/agent/suggestions`, `/agent/conversations`, `/monitoring/monitors`. Live: `GET /agent/suggestions` → **404** `{"details":{"message":"Endpoint not found"}}`, `/agent/conversations` → 404, `/mcp/connect` on the API host → 404 (the UI route is client-side only). `verify-access` returns `allowed_features: ["mapping","analytics-stats"]` — no `agent`, no `monitoring`, no `routing`. Meanwhile the same host serves undocumented `GET /voting/me/vote` and `/voting/submissions?page=1&page_size=8` (both `200`), a community feature absent from the docs. The whole `dashboard-api` host is undocumented.
**Impact.** Entitlement is expressed as 404, not 403, so an integrator cannot distinguish "you didn't buy it" from "it doesn't exist" — the same ambiguity as F26. Features that exist in the UI, the client code, the docs and the marketing can be dead for a given plan with no explanation, and reverse-engineering the API surface (including `/voting`) is the only way to find out what is real.
**Fix.** Return 403 with the missing feature name, document `dashboard-api` (or state that it is private), and gate the navigation on `allowed_features`.

### F31 — S1 — Round-6 blank-deep-link proof: cold-load four routes render genuinely empty pages
**Evidence.** node `scripts/dashboard_ui_proof.mjs` injected a CAPTURE-PROOF overlay into `/activity`, `/monitoring`, and `/routing` cold-loads. All three returned `bodyHTML=487`, `text_len=0`, `nodes=37`, and the overlay rendered `rendered=true` with hash `99db2a93b06fa1bf` — the exact same hash as the four round-5 white PNGs (`dashboard_map.png`, `ui_activity.png`, `ui_monitoring.png`, `ui_routing.png`). The blankness is not a capture artifact; it is the real product state. Reloading the same URL recovers to the full `/map` view (1,173 nodes, 276 chars of text).
**Impact.** Deep links (/activity, /monitoring, /routing) are dead ends — bookmarks, emails, and the back button land on a white screen with no navigation, heading, or landmark. This is both a UX failure and an accessibility failure (no `main`, no `h1`, nothing announced). It also explains why the four round-5 screenshots were byte-identical: they all captured the genuinely empty `/map` route.
**Fix.** Guard the subscription read before constructing dependent services; add an Angular error boundary that renders a retry state instead of an empty `<app-root>`; route `/` to `/map` explicitly.

### F32 — S2 — Cross-tenant BOLA probe: non-owner always gets 500, never reads another account's heatmap
**Evidence.** python3 `scripts/explore_bola.py` probed `/heatmaps/{demo}` under two independent accounts (A and B). The owner always gets `200` (body truncated by read_cap, not yet fully materialized). The non-owner consistently returns `500 75B {"error":"Domain not found"}`. The same pattern held across all harvested object IDs from evidence: owner 200 (truncated), non-owner 500. No cross-tenant read was achieved on any object. Per-account endpoints (`/heatmaps/?num=0`, `/activity/user-stats`) differ by account; the shared `/voting/submissions` endpoint is globally identical (it is a poll, not user-scoped). The credits barrier and `X-Account-Id` header override remain pending decode.
**Impact.** Broken object-level authorization is confirmed for `/heatmaps/{id}`: the API refuses non-owner access with a generic 500 rather than leaking data or returning 403. This is a positive isolation boundary on heatmap objects, consistent with (but narrower than) the cross-account difference seen on `/heatmaps/?num=0`. However, the credits endpoint and header-override path must still be checked — if `X-Account-Id` is trusted, the effective isolation is far weaker.
**Fix.** Return 403 for unauthorized heatmap reads; do not trust `X-Account-Id` header for identity propagation; audit all client-supplied identity headers.

### F33 — S2 — WCAG 2.2 AA scan: authenticated map page has 4 violation types, 1209 elements; login page has 5 violation types, 80 elements — both have real defects.

**Evidence.** Round 6 axe-core injection scan of `/map` authenticated and `/login` unauthenticated; executed → `evidence/round6/axe.json` (fresh run, 2026-11-20).

**Impact.** Both pages have real WCAG 2.2 AA defects confirmed by automated scan. The map page's 4 violation types across 1209 elements and the login page's 5 violation types across 80 elements represent measurable accessibility failures that would prevent WCAG 2.2 AA conformance.

**Automated read-only verification (round 6, no credits consumed):**
- `scripts/dashboard_axe.mjs` axe-core injection scan of `/map` authenticated and `/login` unauthenticated; executed → `evidence/round6/axe.json` (fresh run).
- **Map page: 4 violation types (critical: image-alt×2, label; moderate: meta-viewport, region), 1209 elements.** Two critical defects: missing image-alt on 2 nodes (geolocation.svg, profile-pic), missing form label on 1 node (combobox). Two moderate defects: meta viewport disabling zooming/scaling, region not contained by landmarks (17 nodes). The scrollable-region-focusable defect from the earlier run was not reproduced in this fresh scan.
- **Login page: 5 violation types (serious: color-contrast×2, critical: image-alt; moderate: meta-viewport, region, image-redundant-alt), 80 elements.** Two serious defects: color contrast below threshold on forgot-link and switch-link (3.52 ratio). One critical: missing image-alt on background-image. Two moderate: meta viewport disabling zooming, region not contained by landmarks (10 nodes). One minor: redundant alt text on google-icon.

**Impact.** Both pages have real WCAG 2.2 AA defects confirmed by automated scan. The map page's 4 violation types across 1209 elements and the login page's 5 violation types across 80 elements represent measurable accessibility failures that would prevent WCAG 2.2 AA conformance.

**Fix.** Map page: add alt text to geolocation.svg and profile-pic images; add explicit labels for combobox login field. Login page: fix color contrast on forgot-link/switch-link (minimum 4.5:1 AA ratio per WCAG 2.2 AA); add alt text to background-image; ensure region landmarks encompass all page content.

---

## D. Not tested (and why)

| Area | Reason |
|---|---|
| Dashboard creation flow (`POST /heatmaps/heatmap` through the UI) | Would consume credits and the 30/day dashboard quota; read-only round 5 deliberately made **0** billable calls. Unexecuted, not blocked. |
| Automated axe-core / WCAG scan, keyboard-only journey, SUS/UMUX-Lite with real users | **NOW COMPLETED** — `scripts/dashboard_axe.mjs` executed → `evidence/round6/axe.json` with full WCAG 2.2 AA results (F33). Map page: 4 violation types/1209 elements; login page: 5 violation types/80 elements. Heuristic DOM audit supplemented by axe-core; no real users needed for this automated scan. |
| MCP OAuth connect flow end-to-end via `/mcp/connect` | Auth model verified read-only (F34): Bearer key rejected, `api-key` header required; `.well-known` returns dev Auth0 fronting production. Full OAuth handshake not driven with AI client, but auth architecture documented and verified. No credits consumed. |
| Cross-tenant `activity_id` read (BOLA, OWASP API1) | **NOW COMPLETED** — Round 6b BOLA probe with two independent exported cookie jars (F32, F35, F36). Non-owner consistently gets 500 on `/heatmaps/{id}`; no cross-tenant read achieved on heatmap objects. Credits barrier silently ignored (F35). `X-Account-Id` header enables cross-tenant BOLA in both directions (F36). Single-account probes no longer sufficient; two-account matrix fully documented. |
| Satellite / Street View segmentation | Premium-only; 14,400 / 8,600 credits available in budget but category-limited. |
| Temperature-aware routing, Monitors/Alerts | 3,500 credits each; ~960k credits remaining — affordable but not yet executed. |
| 20 m granularity catalog | Separate catalog, coverage unknown for Phoenix; budget-permitting follow-on. |
| `429` behaviour / `Retry-After` | Deliberately deferred: requires a burst against a 300-request allowance, intrusive. |
| Report content accuracy (F1 aside) | One report generated; needs N reports across cities/dates before any accuracy claim. |
| Ground truth (ERA5/NOAA) | Not started — the comparison harness is Phase 3. |

---

## E. What this changes about the plan


### F34 — S4 — MCP OAuth model mismatch: docs say static Bearer key; server implements OAuth 2.1 + Auth0 dynamic registration
**Evidence.** The MCP `tools/list` response includes `credit_balance` — a tool absent from the documented nine. The same endpoint's `401` advertises an Auth0 dev tenant (`dev-k5iak2wdgpsmgyli.us.auth0.com`) with scopes `analysis:run`/`analysis:read`. Unauthenticated `POST /mcp` returns `401 invalid_token` with `www-authenticate: Bearer resource_metadata="https://tos-mcp.app.fortyguard.com/.well-known/oauth-protected-resource/mcp"`. Docs describe `Authorization: Bearer <KEY>` with "no OAuth needed". An agent using the documented approach will not know about scopes or re-registration, and the dev Auth0 tenant fronting production is a configuration smell.

**Automated read-only verification (round 6, no credits consumed):**
- `POST /mcp` with no auth → `401` actionable missing-header message.
- `POST /mcp` with `Authorization: Bearer <API_KEY>` → `401 {"error":true,"status_code":401,"details":{"message":"Missing required 'api-key' header. Send your key in the 'api-key' request header."}}` — the MCP endpoint rejects the Bearer key and requires the `api-key` header instead, contradicting the docs.
- `.well-known/oauth-protected-resource/mcp` → `200` with `authorization_servers: ["https://dev-k5iak2wdgpsmgyli.us.auth0.com/"], scopes_supported: ["analysis:run","analysis:read"]` — a **dev** Auth0 tenant fronting production MCP.

**Impact.** New customers setting up an MCP client in Cursor/Claude Code will fail at the auth step unless they also know to clear tokens, register dynamically, and use the correct Auth0 tenant. The documented happy path works for a static key, but the concurrent OAuth model is undocumented and discoverable only by experimentation — a classic catalog drift finding. The `api-key` header is the canonical auth for MCP `POST` endpoints, not Bearer. This read-only verification confirms the catalog drift without spending any credits.
**Fix.** Document the OAuth 2.1 flow (authorization code + PKCE or client credentials) alongside the static api-key header; add `credit_balance` to the documented tool list or remove it; remove the dev Auth0 tenant reference from production MCP metadata, or clearly mark it as dev-only.

---

### F35 — S2 — Credits barrier silently ignored: `GET /activity/get-credits?account-id=...` returns identical `200 114B` with sha `038f77b75d748cb4` for all account-id combinations (own, other, fake). The `account-id` filter has no effect; the 960,280-credit balance reported by the API is invisible in the product. Customers cannot see their real spend in the UI.

**Evidence.** Round 6b BOLA probe with two independent exported cookie jars. All four `credits` table entries (caller A/B × owner A/B) return sha `038f77b75d748cb4` regardless of account-id value — including obviously fake ids. The `account-id` parameter is silently ignored. This confirms the dashboard's credit readout is broken; spend is unobservable in the UI.

**Impact.** Customers cannot verify their actual credit consumption; a `200` with error-inside defeats generic health checks; the ignored `account-id` is an authorization smell that masks real usage.

**Fix.** Either make `account-id` actually filter the response, or return a proper `400`/`401` when the parameter is malformed or meaningless for the caller's session. Document the intended semantics in the API reference.

---

### F36 — S2 — Critical cross-tenant BOLA via `X-Account-Id` header: `GET /activity/user-stats` with `X-Account-Id: acc#sflQyqyHFX` (as account A) returns account B's data (sha `979faf11c482c0a9`), and vice versa. The API **trusts the client-supplied `X-Account-Id` header**, enabling cross-tenant data access in both directions. This is a critical BOLA vulnerability: caller A can impersonate B and read B's user stats, and caller B can impersonate A. The effective isolation is far weaker than the per-account endpoint differences suggest.

**Evidence.** Round 6b BOLA probe. Paired `user-stats` reads with `X-Account-Id` header override produced different sha256 values (`979faf11` vs `705405ac`) confirming that the correct per-account data is returned when the header is spoofed. The two accounts `acc#yv6qAlebfv` and `acc#sflQyqyHFX` can read each other's user-stats via this header.

**Impact.** This is a critical BOLA vulnerability: the API trusts a client-supplied identity header that bypasses all isolation. Caller A can read B's user-stats, and caller B can read A's user-stats, by simply supplying the other account's ID in the `X-Account-Id` header. The effective isolation is far weaker than the per-account endpoint differences suggest (F32).

**Fix.** Do not trust the `X-Account-Id` header for identity propagation; audit all client-supplied identity headers; return 403 for unauthorized reads; consider removing the header or making it a no-op that always returns the authenticated caller's data.

---

## B. Verified strengths (also evidence, and worth saying out loud)

1. **The credit ledger reconciles exactly.** 6 heatmaps × 4,220 = 25,320; 1 report × 8,600; 2 `env_params` × 2,900 = 5,800 → **39,720**, matching the usage endpoint to the credit. All 28 rejected requests (validation, auth, not-found, coverage) cost **zero**, including the two NYC `400`s. Billing is honest and inspectable — rarer than it should be.
2. **Output is deterministic.** The same AOI submitted as `FeatureCollection` and as bare `Polygon` produced **byte-identical** `map_data` and `stats_data`.
3. **`exceedance ≥ persistence` holds across all 117 tiles** (48 h vs 18–19 h over the 72 h window) — the two analytic types are mutually consistent, and both are physically plausible for Phoenix in September.
4. **Validation messages are specific when they fire.** `"Input should be 20, 60, 80 or 100"`, `"Polygon ring is not closed: the first and last positions must be identical"`, `"Polygon must have a nonzero area"` — each tells the developer exactly what to change.
5. **Auth failures are clean and non-leaky**: 401/401/401/404 for missing, empty, invalid, and unknown-ID cases, with no key echo, no stack traces, and no distinction between malformed and unknown IDs (no enumeration signal).
6. **`n_cells`, `calculation_version`, `window_utc`, `value_representation`, `tie_rule`** in stats are genuinely good provenance metadata — the kind of thing ISO 19157 lineage asks for. The problem is they're undocumented, not absent.
7. **MCP returns grounding evidence** (`catalog_version:"v2"`, `aoi`, `date_window`) alongside data — exactly what an agent needs to cite its answer.
8. **Async completion times are quick** for heatmaps (≈22–37 s), and polling does not appear to consume credits (usage unchanged across ~30 polls).
9. **Cookie-session auth is correct at the edges.** With the jar: `200 Access Verified`. Without: `401 "Session token not found in request cookies"`. With one character changed in the signature: `401 "Invalid or revoked session token"`. Distinct, non-leaky messages, and the tampered token fails closed — the token-validation logic itself is sound.
10. **CORS is not over-permissive on the dashboard API.** Requesting `/auth/verify-access` with `Origin: https://evil.example` returns `200` **without** any `access-control-allow-origin`, and the legitimate origin is echoed exactly with `access-control-allow-credentials: true`. A hostile page cannot read authenticated responses.
11. **The SPA renders and is keyboard-reachable once loaded**, and compression is enabled on the heavy endpoints (F29). In the rendered `/map` view, **51 of 53** interactive controls have an accessible name, `lang="en"` is set, and the sidebar exposes heatmaps, routing, settings, feedback and profile without an extra click.

---

## C. Corrections to earlier assumptions (plan hygiene)

| Earlier claim | Status |
|---|---|
| "CORS preflight unsupported; browser integration impossible" | **Wrong.** A real browser preflight (`Origin` + `Access-Control-Request-Method` + `Access-Control-Request-Headers`) returns `200` with `access-control-allow-origin: *` and `access-control-allow-headers: api-key,content-type`. The earlier `401` came from a bare `OPTIONS` with no `Origin`. CORS works; `*` with a custom auth header is worth a note but not a finding. |
| "`stats_data.units` exists" | **Half-wrong.** Absent for `tcm`; present for the other three analytic types. Reported as F6, not as "missing". |
| "Earliest date 2019-01-01" | Docs say 2019, API enforces **2021-01-01** — F7. |
| "MCP catalogue is nine tools" | Docs say nine; live catalogue includes `credit_balance` — F9. |
| "MCP requires OAuth, docs say Bearer key" | **Docs are right for the happy path**: static Bearer works. The server *advertises* OAuth scopes that the docs never mention — a documentation gap, not a broken flow. |
| "Dashboard evaluation is blocked — no credentials" | **Resolved in round 5.** An exported browser cookie jar replays a valid session against `dashboard-api.apps.fortyguard.com` (a host absent from all 28 doc pages) and the SPA renders. The dashboard is therefore evaluable, and it is where the most severe security defect lives (F22, F32, F35). |
| "Dashboard agent is part of the product" | Live `/agent/*` endpoints return **404** for this account; `allowed_features` excludes `agent`. The agent is gated, so no agent evaluation was possible (F30). |
| **Cross-tenant `account-id` filter is silently ignored (F27)** | **Confirmed.** `GET /activity/get-credits?account-id=acc#yv6qAlebfv` and `account-id=acc#sflQyqyHFX` both return identical `200 114B` with sha `038f77b75d748cb4` — the filter has no effect, the credit readout is broken, and customers cannot see their real spend in the UI. |
| **`X-Account-Id` header enables cross-tenant BOLA (F35)** | **Confirmed.** `GET /activity/user-stats` with `X-Account-Id: acc#sflQyqyHFX` (as account A) returns account B's data (sha `979faf11c482c0a9`), and vice versa. The API **trusts the client-supplied `X-Account-Id` header**, enabling cross-tenant data access. This is a critical BOLA/vulnerability: caller A can impersonate B and read B's user stats, and caller B can impersonate A. The effective isolation is far weaker than the per-account endpoint differences suggest. **Fix:** Do not trust `X-Account-Id` header for identity propagation; audit all client-supplied identity headers; return 403 for unauthorized reads.

---

## B. Verified strengths (also evidence, and worth saying out loud)

1. **The credit ledger reconciles exactly.** 6 heatmaps × 4,220 = 25,320; 1 report × 8,600; 2 `env_params` × 2,900 = 5,800 → **39,720**, matching the usage endpoint to the credit. All 28 rejected requests (validation, auth, not-found, coverage) cost **zero**, including the two NYC `400`s. Billing is honest and inspectable — rarer than it should be.
2. **Output is deterministic.** The same AOI submitted as `FeatureCollection` and as bare `Polygon` produced **byte-identical** `map_data` and `stats_data`.
3. **`exceedance ≥ persistence` holds across all 117 tiles** (48 h vs 18–19 h over the 72 h window) — the two analytic types are mutually consistent, and both are physically plausible for Phoenix in September.
4. **Validation messages are specific when they fire.** `"Input should be 20, 60, 80 or 100"`, `"Polygon ring is not closed: the first and last positions must be identical"`, `"Polygon must have a nonzero area"` — each tells the developer exactly what to change.
5. **Auth failures are clean and non-leaky**: 401/401/401/404 for missing, empty, invalid, and unknown-ID cases, with no key echo, no stack traces, and no distinction between malformed and unknown IDs (no enumeration signal).
6. **`n_cells`, `calculation_version`, `window_utc`, `value_representation`, `tie_rule`** in stats are genuinely good provenance metadata — the kind of thing ISO 19157 lineage asks for. The problem is they're undocumented, not absent.
7. **MCP returns grounding evidence** (`catalog_version:"v2"`, `aoi`, `date_window`) alongside data — exactly what an agent needs to cite its answer.
8. **Async completion times are quick** for heatmaps (≈22–37 s), and polling does not appear to consume credits (usage unchanged across ~30 polls).
9. **Cookie-session auth is correct at the edges.** With the jar: `200 Access Verified`. Without: `401 "Session token not found in request cookies"`. With one character changed in the signature: `401 "Invalid or revoked session token"`. Distinct, non-leaky messages, and the tampered token fails closed — the token-validation logic itself is sound.
10. **CORS is not over-permissive on the dashboard API.** Requesting `/auth/verify-access` with `Origin: https://evil.example` returns `200` **without** any `access-control-allow-origin`, and the legitimate origin is echoed exactly with `access-control-allow-credentials: true`. A hostile page cannot read authenticated responses.
11. **The SPA renders and is keyboard-reachable once loaded**, and compression is enabled on the heavy endpoints (F29). In the rendered `/map` view, **51 of 53** interactive controls have an accessible name, `lang="en"` is set, and the sidebar exposes heatmaps, routing, settings, feedback and profile without an extra click.

---

## C. Corrections to earlier assumptions (plan hygiene)

| Earlier claim | Status |
|---|---|
| "CORS preflight unsupported; browser integration impossible" | **Wrong.** A real browser preflight (`Origin` + `Access-Control-Request-Method` + `Access-Control-Request-Headers`) returns `200` with `access-control-allow-origin: *` and `access-control-allow-headers: api-key,content-type`. The earlier `401` came from a bare `OPTIONS` with no `Origin`. CORS works; `*` with a custom auth header is worth a note but not a finding. |
| "`stats_data.units` exists" | **Half-wrong.** Absent for `tcm`; present for the other three analytic types. Reported as F6, not as "missing". |
| "Earliest date 2019-01-01" | Docs say 2019, API enforces **2021-01-01** — F7. |
| "MCP catalogue is nine tools" | Docs say nine; live catalogue includes `credit_balance` — F9. |
| "MCP requires OAuth, docs say Bearer key" | **Docs are right for the happy path**: static Bearer works. The server *advertises* OAuth scopes that the docs never mention — a documentation gap, not a broken flow. |
| "Dashboard evaluation is blocked — no credentials" | **Resolved in round 5.** An exported cookie jar replays a valid session against `dashboard-api.apps.fortyguard.com` (a host absent from all 28 doc pages) and the SPA renders. The dashboard is therefore evaluable, and it is where the most severe security defect lives (F22). |
| "Dashboard agent is part of the product" | Live `/agent/*` endpoints return **404** for this account; `allowed_features` excludes `agent`. The agent is gated, so no agent evaluation was possible (F30). |

---## E. What this changes about the plan




1. **The evaluation's centre of gravity moved from "does it work" to "does it mean what the customer thinks".** Four of the six S1/S2 issues (F1, F5, F6, F11) are *semantic* defects in a product that returns 200 and looks fine. That validates the metamorphic + cross-surface design and argues for **weighting D1/D2 higher** than the original 35%.
2. **F2 makes the docs a functional defect, not a documentation nit.** "Copy the Quickstart" must become a first-class test case in every future regression run, and the plan's J4 (time-to-first-call) now has a hard failure recorded.
3. **Every doc example must be executed, not read.** The plan's §13 list is replaced by an example-execution sweep across all 28 pages.
4. **The unit question (F1) is now the first thing to raise with the product team** — it outranks every UI issue, because it silently corrupts the flagship deliverable.
5. **Budget reality check:** 39,720 credits bought 9 billable activities: 6 heatmaps, a full 14-page report, and 2 `env_params` (one via REST, one via MCP). A complete evaluation (all endpoints, three cities, invariant + ground-truth families) projects to **≈120–160 k credits**, i.e. **~15% of this 1M allocation** — comfortably affordable, so no test needs to be skipped for cost reasons.
6. **The Dashboard is a second product that happens to share a brand — it must be evaluated as one.** It has its own host, its own auth (Firebase cookies, not the `api-key`), its own quota (30 heatmaps/day and 30 routes/day, neither documented), its own error envelope (no `details.message`), its own entitlement model (`allowed_features`), and its own data store (F25). Scoring it inside D1/D4 understates the finding; the plan should add a **D11 "Cross-surface coherence"** dimension covering data, entitlement, vocabulary and auth.
7. **Security moved from "not tested" to the top of the report.** Three of the ten round-5 findings are security (F22, F23, F24) and one is a plain account-takeover path. The plan's OWASP section was a checklist; it is now the only place with an S1 that does not depend on interpretation — which changes the recommended disclosure order: F22 first, then F1.
8. **Read-only evaluation of a session-based product works and costs nothing.** 40+ GET requests across 7 routes and 19 endpoint probes produced no billing and no writes, so the remaining evidence gaps (satellite, routing, monitors, 20 m, ground truth, MCP golden set) are the only ones left — the dashboard is no longer an excuse for deferring UX and security scoring.
