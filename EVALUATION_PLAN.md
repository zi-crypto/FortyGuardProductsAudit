# FortyGuard Product Evaluation — Test & Evaluation Plan (Phase 0: Planning)

**Status:** planning complete; rounds 1–5 executed (REST, MCP, Dashboard — see §12)
**Products in scope:** Temperature Dashboard® · Temperature API® · FortyGuard Temperature MCP
**Location under test:** United States — **Phoenix, AZ** (33.4484, −112.074) as primary AOI, **New York, NY** (40.7128, −74.0060) as secondary, **Chicago, IL** (41.8463, −87.7433) for the docs' own satellite example
**Evaluator stance:** first-time paying customer, black-box, evidence-first

---

## 1. What this evaluation is (and is not)

A **conformance + usability + data-validity evaluation** of three products that are really one data product with three interfaces:

| Product | Interface type | Primary quality question |
|---|---|---|
| Temperature API® | REST, async task model | Can a competent developer integrate it correctly, first try, and trust the numbers? |
| Temperature Dashboard® | Angular web app | Can a non-developer answer a heat question without training? |
| Temperature MCP | Remote MCP server (9 tools) | Can an AI agent pick the right tool and produce a correct, non-hallucinated answer? |

It is **not** a penetration test, a load test at scale, or a formal usability lab study with a recruited sample. Those are out of scope and will be labelled as such wherever they limit a conclusion (§11).

---

## 2. Standards basis

The evaluation is deliberately mapped to published standards rather than an ad-hoc checklist, because the deliverable is meant to be defensible to a product team and reproducible by someone else.

**Product quality & evaluation process**
- **ISO/IEC 25010:2023** — product quality model; nine characteristics used as the top-level rubric spine (functional suitability, performance efficiency, compatibility, interaction capability, reliability, security, maintainability, flexibility, safety).
- **ISO/IEC 25019** — quality-in-use model (effectiveness, efficiency, satisfaction, freedom from risk, context coverage) — used for the customer-journey scoring, separate from product quality.
- **ISO/IEC 25040:2024** — evaluation framework: *define the evaluation → design the evaluation → execute → conclude*. §3, §5–§8 of this document are that process, made explicit.
- **ISO/IEC 25041** — evaluation guide for independent evaluators (rigour, independence, evidence traceability).

**Testing process & test design**
- **ISO/IEC/IEEE 29119-1:2022** — concepts: test basis, test oracle, sampling, independence.
- **ISO/IEC/IEEE 29119-2:2021** — risk-based test process at organizational/management/dynamic levels.
- **ISO/IEC/IEEE 29119-4** — test design techniques applied in §7: equivalence partitioning, boundary value analysis, decision tables, state-transition testing, pairwise/combinatorial coverage, negative & fault-injection testing.
- **Metamorphic testing** (Chen et al.) — the correct technique when there is no cheap oracle for a model output; relations listed in §7.4.

**Geospatial data quality**
- **ISO 19157-1:2023** — data quality elements: completeness (commission/omission), logical consistency, positional accuracy, temporal quality, thematic accuracy, usability. Directly applicable: a heatmap is a gridded geospatial dataset and a segmentation is a classified one.
- **WMO-1292 (2023), Guidance on Measuring, Modelling and Monitoring the Canopy Layer Urban Heat Island** — model skill must be assessed against observations, *and* judged against the intended use case; representativeness of the observational site is itself an uncertainty source. This governs how we score accuracy claims.

**Usability / developer experience**
- **Nielsen's 10 heuristics** + **Cognitive Dimensions of Notations** (Blackwell) — for dashboard and docs review.
- **Cognitive walkthrough** + **heuristic evaluation with n≈5 expert passes** (Nielsen & Landauer 1993: ~85% of defects found with 5 evaluators).
- **SUS** (Brooke) and **UMUX-Lite** (Lewis, Utesch & Maher 2013) with the published SUS↔UMUX-Lite regression — for perceived usability, benchmarked against Bangor/Sauro/Israel's SUS mean ≈ 68.
- **NASA-TLX** — mental workload per task; catches "it works but it's exhausting".
- **API usability**: Rauf, Troubitsyna & Porres (2019) systematic mapping of API usability factors; Piccioni, Furia & Meyer (2013) empirical API usability study; Rama & Kak (2013) structural API measures (parameter counts, naming).

**Accessibility**
- **WCAG 2.2 Level AA** — 55 success criteria; dashboard-concentrated risks are 1.4.3/1.4.11 contrast, 2.1.1 keyboard, 2.4.7 focus visible, 2.5.7 dragging alternatives, 2.5.8 target size, 3.3.7 redundant entry, 4.1.3 status messages.

**Agent / MCP quality**
- **MCP specification (2026-07-28) — Server/Tools** — tool schemas, human-in-the-loop expectations.
- **AWS Prescriptive Guidance, MCP strategies** — ≤8 parameters per tool, don't map one tool per endpoint, separate read/write, workflow-scoped tools.
- **Anthropic, "Writing Effective Tools for Agents"** — evaluation loop: prototype → user test → eval → iterate.
- **MCP eval methodology** (Braintrust guide, 2026; Hugging Face MCP-with-coding-agents guide) — score **tool selection, argument accuracy, task completion, output use, error recovery, efficiency, consistency across repeats**; and the arXiv study on *MCP tool description smells* (97.1% of descriptions had ≥1 smell) as the rubric for description quality.

---

## 3. Evaluation design (ISO 25040 mapping)

### 3.1 Purpose
Determine, with evidence, whether a new customer can **reach a trustworthy, correctly-interpreted result** in each of the three products, and quantify where that fails.

### 3.2 Target entities
1. `https://api.fortyguard.com` — 6 analysis POSTs, 1 status GET, credits GET/POST, 4 monitor endpoints, 2 alert endpoints.
2. `https://dashboard.fortyguard.com` — login/signup, map, heatmap, monitoring, routing, MCP connect, embedded AI agent (`/agent/query`).
3. `https://tos-mcp.app.fortyguard.com/mcp` — 9 tools.
4. Supporting surfaces: docs SPA (`docs-api.fortyguard.com`, 28 routes), pricing page, free-key/internship flow, QGIS plugin.

### 3.3 Quality criteria
The weighted rubric in §9. Weights reflect that this is a **data product**: wrong numbers are worse than ugly buttons.

### 3.4 Rigour
- Every finding: **severity (S1–S4), evidence (request/response, screenshot, transcript), reproduction steps, expected-vs-actual, standard clause or rule violated**.
- Two-rater severity scoring with **Cohen's κ** on a 20-finding sample; κ < 0.6 → adjudication round.
- Repeat measurements: API determinism **k = 3 identical requests**; latency **n = 20** per endpoint; pass rates reported with **Wilson 95% CI**.
- Anything not directly observed is marked **"not tested"**, never inferred.

---

## 4. What we already observed (evidence log)

> **Rounds 1–4 have since been executed against the live API and MCP.** Confirmed defects, evidence and severity are in **[FINDINGS.md](FINDINGS.md)**. The observations below are the pre-key reconnaissance that shaped the plan; where execution contradicted them, FINDINGS.md §C carries the correction and they are marked *(revised)* here.

These are done. They already generate findings and they shape the rest of the plan.

**E1 — API is the real entry point and it is up.**
`GET https://api.fortyguard.com/v1/status/` → `HTTP/2 401`, `server: envoy`, body:
```json
{"error":true,"status_code":401,"details":{"message":"Missing required 'api-key' header. Send your key in the 'api-key' request header."}}
```
**Read:** excellent first-contact error. Machine-parseable envelope, human-actionable remedy, correct status code. This is above industry average and should be scored as a strength.

**E2 — Latency baseline is measurable but slow to first byte.**
3 unauthenticated calls: DNS ≈ 0.08 s, TLS ≈ 0.52–0.63 s, TTFB ≈ 0.75–0.91 s, total ≈ 0.75–0.91 s, response 138 B, all `401`. Cold-connection TTFB of ~0.8 s from a US-adjacent host is worth flagging against the async-task model (see E10).

**E3 — CORS: bare `OPTIONS` looks broken, real preflights work.** *(revised after execution)*
`OPTIONS /v1/heatmap` with no `Origin` → `401`, no `Access-Control-*` headers. But a genuine browser preflight (`Origin` + `Access-Control-Request-Method` + `Access-Control-Request-Headers`) → **`200` OK** with `access-control-allow-origin: *` and `access-control-allow-headers: api-key,content-type`.
**Read:** browser integration is possible, so the original “no CORS” assessment was wrong — corrected in FINDINGS.md §C. Remaining note: `ACAO: *` on an authenticated API is worth a conversation, not a finding.

**E4 — No machine-readable contract.**
`/openapi.json`, `/api/openapi.json`, `/sitemap.xml`, `/llms.txt` all return the SPA HTML shell (`200 text/html`, 1,419 B). `GET /docs/does-not-exist` → **200** (catch-all route).
**Read:** (a) no OpenAPI/Postman/TypeScript client, so codegen, schema validation, and agent tool-building all require hand-copying; (b) docs 404s are silent, so stale links look healthy; (c) for a company shipping an *MCP for agents*, not publishing `llms.txt`/OpenAPI is the single highest-leverage, lowest-cost fix.

**E5 — Documentation surface is larger than the release notes admit.**
28 routes captured: 6 guide pages (introduction, quickstart, authentication, limitations, release notes, generate-free-key, credits-usage, check-status), 6 MCP pages, 12 monitoring/alert pages, QGIS, 6 analysis endpoint pages.
Release Notes has exactly **one** entry: **v1.0.0, April 22, 2026** — which does **not** mention MCP, Monitoring & Alerting, Temperature-Aware Routing, or the QGIS plugin, all of which are fully documented.
**Read:** documentation drift of an unknown number of releases. A customer cannot tell when routing or MCP became available, or what changed. → **finding: released without release notes**.

**E6 — Auth model is inconsistent between REST and MCP, documented as if it weren't.**
- REST: `api-key: <KEY>` (docs, and E1 confirms).
- MCP docs: `Authorization: Bearer <KEY>`, "no OAuth needed".
- Actual MCP server: unauthenticated `POST /mcp` → `401` with
  `www-authenticate: Bearer resource_metadata="https://tos-mcp.app.fortyguard.com/.well-known/oauth-protected-resource/mcp"`.
- That metadata (`GET`, 200, cache 3600) returns an **Auth0 tenant**: `https://dev-k5iak2wdgpsmgyli.us.auth0.com/`, `scopes_supported: ["analysis:run","analysis:read"]`.
- Invalid bearer → `401 invalid_token` whose text tells the user to *"clear authentication tokens in your MCP client and reconnect. Your client should automatically re-register and obtain new tokens."* `x-envoy-upstream-service-time: 986 ms` for a rejected token.
- `GET /mcp` → `405`, `allow: POST, DELETE` (spec-conformant for a Streamable HTTP endpoint that doesn't offer SSE GET).
**Read:** the server implements an **OAuth 2.1 protected-resource + dynamic-registration flow**, while the documentation describes **static API-key-in-header**. For a first-time user in Cursor/Claude Code, that mismatch is where the setup will fail, and the docs' troubleshooting page does not mention OAuth, scopes, re-registration, or token clearing at all. **Top-3 finding candidate**, and it is testable immediately with a valid key. Also: a *dev* Auth0 tenant (`dev-…`) fronting a production MCP endpoint is a configuration smell worth reporting neutrally.

**E7 — MCP tool catalog is 1:1 with REST endpoints.**
9 tools: `env_params`, `heatmap`, `heatmap_read`, `report`, `report_read`, `satellite`, `streetview`, `temperature_routing`, `temperature_routing_read`. Async pairs are explicit. But AWS/Anthropic guidance says one-tool-per-endpoint is the canonical anti-pattern; `wait_for_completion` additionally duplicates the read tools; tool descriptions state purpose and "when to use" but never **"when not to use"**, which is the field that prevents wrong-tool selection between `heatmap` and `report`, or `env_params` and `report`.

**E8 — Documented contract contradictions to test (not assumptions — assertions to falsify).**
1. `heat_intelligence.temperature` is documented as **"Temperature value in degrees Fahrenheit"**, while the same field's `date` description says "Date for the supplied **Celsius** temperature". `env_params.temperature` is Celsius. `mcp-tools` says "reference temperature in degrees Celsius" for `report`. Three statements, two units → unit-confusion bug risk in the headline Premium endpoint.
2. Satellite result field is documented as `Orignal_image` (misspelled) with "legacy alias `orignal_image`" — an inconsistency preserved in the public schema.
3. Docs' Quickstart says "**six** POST endpoints"; the sidebar plus monitoring CRUD exposes more.
4. Heatmap large-result path returns `map_download_url` / `stats_download_url`, and "downloaded map artifacts retain legacy storage encoding and **may require a second JSON decode**". Double-encoding is a contract defect, not a quirk.
5. `Check Status`: **404** is documented both as "activity not found" *and* "temporarily unavailable immediately after submission" → a client cannot distinguish permanent from transient failure. Retry logic is undefined, and the quickstart's example treats any non-Completed/Failed status as "keep polling", i.e. it would poll a 404 forever.
6. Segmentation images return Base64 **without** the `data:` MIME prefix, so naive `<img src>` rendering fails.

**E9 — Numeric contract is rich enough for real metamorphic testing.**
`filter_type` 1–4 (single hour / range of hours / single day / range of days ≤31), `granularity` 20/60/80/100 m, `analytic_type` ∈ {tcm, time_of_measure, exceedance, persistence}, `threshold` default 30 °C, `direction` ∈ {above, below}, `time_of_measure` returns clock hour 0–23 (AOI timezone at 20 m, **UTC at other resolutions** — a documented unit inconsistency across granularities), `persistence` counts days for day-ranges at 20 m otherwise hours, exceedance is strict while persistence includes equality. This is fertile ground for invariant tests (§7.4) and it is the most likely place a real defect hides.

**E10 — Async model + credits = the economics of testing.**
Credits (Premium): heatmap 4,220 · env_params 2,900 · satellite 14,400 · streetview 8,600 · heat_intelligence 8,600 · routing 3,500 · monitor/alerts 3,500 each. Basic/Startup: heatmap 3,500 · env_params 2,110, and satellite/streetview/report/routing are **not included**.
Credits are deducted **only on Completed**; Failed is free; **no rollover**; Startup is a one-time 6-month 1M allocation.
Plan limits: heatmap area 10 mi² (Basic) / 50 mi² (Premium); env_params 3 params (Basic) vs all (Premium); US-only coverage; routing ≤ **200 km great-circle**; earliest date **2019-01-01**; 20 m uses a **separate catalog** where partial output can still "succeed".
**Read:** a full one-shot pass over every Premium endpoint is ≈ **36,320 credits** (0.7% of a 5M allocation) — the evaluation is affordable. But "partial results can succeed", "no forecast coverage is guaranteed", and "acceptance does not guarantee coverage" mean **a 200 OK is not evidence of correctness**; completeness must be measured separately (ISO 19157 completeness). That is the central methodological point of this whole plan.

**E11 — Dashboard surface (from the shipped bundle, before login).**
`dashboard-api.apps.fortyguard.com` exposes: `/auth/{email-login,signup,verify-email,reset-password-email,refresh-tokens,verify-access,subscribed-states,logout}`, `/heatmaps/heatmap`, `/routing/submit`, `/monitoring/monitors`, `/mcp/connect`, `/activity/{dashboard-presence,rename-activity,flag-activity,tour-progress,user-stats}`, `/first-time-events`, **and an embedded agent**: `/agent/{query,query/stream,interpret,resume,suggestions,conversations,feedback}` backed by `tos-agent-core.app.fortyguard.com`.
**Read:** the Dashboard is not a viewer — it is a heatmap studio **plus a natural-language agent**, which means there are effectively **two AI surfaces** to evaluate (in-app agent and MCP), and they must be scored for *consistency with each other*. Login offers email/password, Google OAuth, forgot-password, signup.
**Also observed:** the Dashboard `index.html` ships the Google Maps JS key inline (`AIzaSyBbwIu32a3D8ZxcCTBeCErNcaE3Te8Jb_c`) — normal for Maps JS, but referrer-restriction is then a testable security control. The docs site loads **Microsoft Clarity** session recording + GA4 + Cloudflare Turnstile. Clarity on a page where users paste API keys (`/docs/credits-usage` has an "Enter Your API Key" field) is a **privacy/security test with a concrete failure mode**: does a pasted key get captured in a session replay? That is a legitimate, non-invasive check on our own key and a potential S1.

**E12 — Free-key path exists and is the realistic "new customer" entrance.**
`POST` free-key form via email ("full Premium access at no cost" for internship-programme signups, Turnstile-protected), plus `/docs/credits-usage` which asks you to paste a key into a web form to see usage.
**Read:** the first-run journey we must actually measure is: docs → free key → first call. And there is a security-UX question: **pasting a production API key into a public docs page** to check credits is a pattern that trains bad habits; recommend key-masked display and a POST-only flow with no logging.

---

## 5. Customer journey we will score (quality-in-use, ISO 25019)

Each step gets: time-on-task, error count, help-seeking count, abandonment, SUS/UMUX-Lite, TLX.

| # | Step | Instrument | Pass condition (proposed) |
|---|---|---|---|
| J1 | Land on product, understand what it sells | 5-second test, comprehension Qs | ≥4/5 can state what it does and its unit of analysis |
| J2 | Find pricing & plan gating | task timing | Plan differences (Basic vs Premium) understood without docs |
| J3 | Get a key | time-to-key, friction log | < 3 min, no dead end |
| J4 | First successful call | **TTFC** (time to first correct call) | ≤ 10 min from docs landing |
| J5 | First *async* result retrieved | TTFR | ≤ 15 min incl. polling |
| J6 | Render the result (GeoJSON/Base64) | task success | Renders without reading source code |
| J7 | Dashboard: answer one heat question | task success + SUS | ≥ 4/5 unaided |
| J8 | MCP: connect in a real client | time-to-connected-tools | ≤ 10 min, catalog visible |
| J9 | MCP: ask a question in natural language | correctness | Agent picks right tool, no invented params |
| J10 | Hit a limit (area, date, region) and recover | recovery rate | Clear, actionable error |

---

## 6. Dimension-by-dimension rubric (the scorecard)

Anchors 1–5, with 3 = "meets a reasonable market expectation for a paid data API in 2026".

| # | Dimension | ISO 25010 / 19157 anchor | Weight | What earns a 5 |
|---|---|---|---|---|
| D1 | **Functional correctness of the API contract** | functional suitability; logical consistency | 15% | Every documented field/unit/enum matches behaviour; invariants hold; determinism k=3 |
| D2 | **Data validity & trustworthiness** | 19157 thematic + temporal + completeness; WMO-1292 | 20% | Errors vs independent observations stated and within a defensible band; completeness reported; no silent partials |
| D3 | **API developer experience** | interaction capability; API-usability literature | 12% | First-try success, machine-readable spec, consistent envelopes, no undocumented CORS/SDK gaps |
| D4 | **Documentation quality** | interaction capability / maintainability | 8% | Every claim tested true; units unambiguous; accurate release notes; copy-paste examples run |
| D5 | **Dashboard usability** | interaction capability; quality-in-use | 15% | Task success, SUS ≥ 80, WCAG 2.2 AA, no dead ends |
| D6 | **Dashboard data integrity** | reliability; 19157 | 5% | Legend/units/scale match API; no client-side silent reprojection or clipping |
| D7 | **MCP / agent effectiveness** | functional suitability for agents | 12% | Tool selection ≥ 90% on golden set, 0 invalid-arg retries, correct async handling, honest failures |
| D8 | **Reliability & performance** | reliability; performance efficiency | 6% | p95 latency stated & met; retry semantics defined; idempotency; no duplicate charges |
| D9 | **Security & privacy** | security | 4% | Cross-tenant isolation, no key capture in analytics, scoped/OAuth path documented, no verbose internals |
| D10 | **Commercial clarity** | flexibility; quality-in-use | 3% | Credits predictable, failures free, limits discoverable before you hit them |

**Severity scale:** S1 blocks the core job or risks a wrong decision / data exposure · S2 forces a workaround or causes material confusion · S3 friction, cosmetic-but-annoying · S4 nitpick. **A single S1 caps its dimension at 2/5** regardless of other strengths.

---

## 7. Test design (ISO 29119-4 techniques, made concrete)

### 7.1 Equivalence classes & boundaries (per endpoint)
- **Coordinates:** US interior (valid) · coastal · Alaska/Hawaii · Canada/Mexico (out-of-region) · `0,0` (null island) · poles ±90 · ±180 · lat=90.0001 · lon-string `"-74.0060"` · `NaN` / `Infinity` / `1e400`.
- **Dates:** 2019-01-01 (min) · 2018-12-31 · today · future +1y · 2024-02-29 (valid leap) · 2023-02-29 (invalid) · filter_type 4 with 31-day and 32-day spans · DST spring-forward day · `23:59`→`00:00` crossing · `end_time < start_time`.
- **Geometry:** closed ring (valid) · unclosed ring · <4 points · self-intersecting bowtie · polygon with hole · multipolygon · antimeridian-crossing · area 9.9 / 10.1 / 49.9 / 50.1 mi² (plan boundary) · 1 m² degenerate · huge bbox.
- **Enums:** `granularity` 19/20/21 · 59/60 · 79/80 · 99/100/101 · `analytic_type` valid + `"TCM"` uppercase + unknown · `direction` `above|below|"Above"` · `threshold` omitted / 0 / −40 / 60 / string.
- **Routing:** distance 199.9 / 200.0 / 200.1 km · origin == destination · origin in ocean · `departure_time` malformed / no timezone / past / +30d.
- **Monitors:** `name` 0 / 1 / 120 / 121 chars · duplicate name on same heatmap · 0 / 1 / 20 / 21 rules · no notification channel · cursor at first/last page · `limit` 0 / 1 / 100 / 101.

### 7.2 State-transition testing (the async lifecycle)
Model: `(none) → Accepted/Processing → Completed | Failed`, plus the documented `404 = not found OR not yet available`. Test:
- Poll immediately after submit (race: does 404 appear? for how long?).
- Poll far too often (is there backoff/`Retry-After`? does polling cost credits? — docs don't say, this is a real risk).
- Submit, then never poll; submit twice with identical payload (**do we get charged twice?** — idempotency test, potentially S1 commercially).
- `GET /v1/status/{id}?result_delivery=links` for a large map; verify signed URL expiry and the documented "second JSON decode".
- Cross-tenant read: with **two keys we own**, request the other key's `activity_id` → expect `403/404`, any data returned is an **S1 IDOR**. (Authorized: our own accounts, single read, no enumeration.)

### 7.3 Combinatorial coverage (pairwise)
Factors: `filter_type` (4) × `analytic_type` (4) × `granularity` (4) × AOI size class (2) × plan (2) = 256 full-factorial → **~12 pairwise cases** cover all pairs. Add a small full-factorial subset for the highest-risk cells (`exceedance` × `filter_type 4` × `20 m`).

### 7.4 Metamorphic relations (the core of D2 without a perfect oracle)
These are falsifiable invariants. Any violation is a defect with a reproduction, independent of ground truth:
1. `min(stats) ≤ mean ≤ max(stats)`; `std_dev ≥ 0`; `Overall_temperature_distribution` sorted non-decreasing; `Temperature_frequency` counts sum ≈ tile count.
2. Same request twice (k=3) → byte-identical `stats_data` (determinism), modulo known service updates.
3. **Exceedance ≥ persistence** (count of hours above threshold ≥ longest run above it) for the same AOI/time/threshold; equality only when the run spans the whole window.
4. `threshold = 30, direction=above` hours + `threshold = 30, direction=below` hours = total hours in the window (± boundary equality rule).
5. `analytic_type=time_of_measure` returns integers 0–23 **and** matches the hour requested under `filter_type=1` (and exposes the documented UTC-vs-AOI-timezone difference at 20 m — test explicitly).
6. `filter_type=3` (single day) mean ≈ mean of its 24 hourly `filter_type=1` calls (allow small tolerance; if wildly different, the day-range is not an aggregation of hours and must be documented).
7. Splitting an AOI into two halves → union of tiles ≈ whole; per-half means reconcile to whole within tolerance (positional/aggregation consistency, ISO 19157).
8. `env_params` at (lat,lon) vs `heatmap` tcm centre tile at same hour: same physical quantity, so difference should be explainable (surface-candidate tile vs point weather) — **not** required to match, but a >10 °C gap must be *explained* in docs or it is a thematic-accuracy finding.
9. `heatmap` on `granularity=100` vs `60` over the same AOI: tile count ratio ≈ (100/60)², extent identical, mean temperature close (coarser ≠ different climate).
10. `report` for a location whose `heatmap` says 45 °C should not describe a mild day (cross-product consistency, the deepest test in the suite).

### 7.5 Ground-truth validation of temperature (D2, WMO-1292 compliant)
- **Reference data (no key, no cost):** Open-Meteo ERA5 / ERA5-Land hourly `temperature_2m`, `relative_humidity_2m`, `apparent_temperature`, `shortwave_radiation`; plus NOAA ISD station observations for Phoenix Sky Harbor (KPHX), NYC (KNYC/KJFK), Chicago (KMDW) as *point* truth.
- **Design:** 3 cities × 3 heat-wave days (July) × 4 hours (06/12/15/22 local) × 20 random tiles inside the AOI, stratified urban-core / residential / park / industrial using satellite segmentation classes as the stratifier.
- **Metrics:** MBE, MAE, RMSE, nRMSE, Pearson r on the diurnal cycle, and **spatial rank correlation** of tile temperature vs. station-relative anomaly. Report per stratum, not just pooled — a model can be unbiased on average and useless in a park.
- **Explicitly stated caveat:** ERA5 at 9–25 km and a station siting in an urban canyon are both *representativeness* errors (WMO-1292 §6.3); we therefore report a **plausibility band**, not a verdict of "wrong", and we never claim sub-100 m accuracy from a 9 km reference.
- **Segmentation (ISO 19157 thematic accuracy):** compare class percentages against OpenStreetMap-derived land-cover proxies for the same tile (building/vegetation/road fractions) → report agreement per class, plus the **imagery capture-date mismatch** (docs admit returned imagery may not match the requested date) as a temporal-quality finding with a measured delta.
- **Completeness:** for every heatmap, count returned tiles vs expected tile grid from AOI+granularity; report % completeness, and whether partial coverage is surfaced to the caller at all. This is the test that catches "200 OK, 40% of the city missing".

### 7.6 Security checks (limited, authorized, non-destructive)
Key handling in Dashboard/Clarity replay · key in URL or logs · verbose stack traces on 500 · CORS (E3) · cross-tenant `activity_id` · rate-limit behaviour & `Retry-After` on 429 · JWT/OAuth scope enforcement on MCP (`analysis:run` vs `analysis:read`) · whether a revoked key fails closed · whether `download_link` signed URLs are guessable/expiring · **X-Account-Id header BOLA (F36): API trusts client-supplied `X-Account-Id` header, enabling cross-tenant data access in both directions via `/activity/user-stats`; **credits barrier F35: `account-id` filter silently ignored, returning identical `200` for all values, making real spend unobservable in the UI**.

### 7.7 Accessibility & UX instrumentation
Keyboard-only pass of the whole Dashboard journey; **axe-core scan completed (F33): map page 4 violation types/1209 elements, login page 5 violation types/80 elements**; contrast sampling on the temperature legend (**a heat legend is a classic 1.4.1 "use of colour" failure**); 200% zoom; status-message announcements for async completion (4.1.3); map interactions with screen reader. **Map page violations: critical image-alt (2 nodes), critical label (1 node), moderate meta-viewport (1 node), moderate region (17 nodes). Login page violations: serious color-contrast (2 nodes), critical image-alt (1 node), moderate meta-viewport (1 node), moderate region (10 nodes), minor image-redundant-alt (1 node).**

---

## 8. MCP evaluation protocol (the part most evaluations get wrong)

A server can pass protocol tests and still be unusable by an agent. We score the **trajectory**, not just the answer.

**Golden task set — 18 prompts, 6 categories × 3, written the way a customer would speak, with no tool names:**
1. Point lookup: *"How hot did it feel in Phoenix on Sept 20 2025 at 3pm?"* → `env_params`.
2. Area heat: *"Map the heat across downtown Phoenix last July 15 at 2pm at the finest resolution you can."* → `heatmap` + poll `heatmap_read`.
3. Comparative/judgement: *"Which is hotter right now, my warehouse in Phoenix or my office in Tucson?"* → two calls; tests multi-tool planning.
4. Imagery: *"What fraction of that block is vegetation vs pavement?"* → `satellite` (+ `streetview` disambiguation — **the key confusion pair**).
5. Routing: *"Find me the coolest walking-ish drive from A to B at 5pm."* → `temperature_routing` + read; must respect the 200 km and coverage limits.
6. Ambiguous/underspecified: *"Is it hot there?"* with no location → must **ask**, not invent a coordinate. Refusal-to-guess is a scored behaviour.

**Scored signals (0/1/2 each, per the MCP-eval literature):** correct tool selected · no redundant/wrong-tool calls · arguments valid *and semantically right* (right units! °C vs °F, right date, right granularity) · async handled correctly (no duplicate submission while Processing) · result used in the answer · error recognized and recovered · final answer grounded in returned numbers (no hallucinated temperature) · efficiency (tool calls, tokens) · consistency across **3 repeats**.

**Description audit:** each of the 9 tools scored against the 6-component rubric (purpose / when-to-use / when-not-to-use / parameter semantics+units / constraints / output shape). Report the "smell" rate and propose rewritten descriptions with a diff — cheap, high-value deliverable.

**Clients:** Claude Code (primary), Cursor (secondary), plus a raw JSON-RPC client harness for protocol-level assertions (`initialize` → `tools/list` → `tools/call`), so client quirks are separable from server defects. Also test the **OAuth path** the server advertises (E6) versus the documented static-Bearer path, and record which one actually works and what the client does on its own.

**Consistency across surfaces:** same question to the Dashboard agent and to MCP → must not contradict. Any divergence is a finding, because the customer cannot know which one is right.

---

## 9. Execution plan

| Phase | Work | Output | Effort |
|---|---|---|---|
| **P0** | Harness: `.env` key, request/response recorder, timing logger, credit ledger, result store (`runs/<date>/<endpoint>/…json`), notarized evidence index | reproducible run log | 0.5 d |
| **P1** | Docs & onboarding audit: 28 pages vs behaviour, link/claim checking, TTFC/TTFR measurement, J1–J5 | docs defect list + journey metrics | 0.5 d |
| **P2** | API conformance: §7.1–7.3 (~90 requests), error-envelope catalogue, CORS/spec gaps | findings F-API-* | 2 d |
| **P3** | Data validity: §7.4 invariants + §7.5 ground truth (~120 requests, budget ≤ 400k credits) | validity report + charts | 2 d |
| **P4** | Dashboard: heuristics, cognitive walkthrough, keyboard/axe, SUS + TLX, agent consistency | UX report, screenshots | 1.5 d |
| **P5** | MCP: raw-JSON-RPC + Claude Code + Cursor, 18 golden tasks × 3 repeats, description audit, OAuth vs key | MCP eval matrix | 1.5 d |
| **P6** | Synthesis: severity adjudication, weighted scorecard, repro pack, exec summary | final report | 1 d |

≈ **9 working days**, ≈ **35–60 k credits** (≈1% of a Premium allocation), ~250–300 recorded calls. Every call logged with credits-before/after so the *credit ledger* itself becomes a finding (does the documented cost match the deduction? `failed` tasks free?).

**Deliverables**
1. **One-page executive verdict** (per product: score, 3 strengths, 3 blockers).
2. **Findings register** — S1–S4, each with evidence, repro, expected vs actual, standard clause, suggested fix, effort.
3. **Weighted scorecard** (§6) with confidence notes.
4. **Data-validity report** — MBE/RMSE/MAE per city/stratum, completeness %, invariants table.
5. **MCP matrix** — 18 tasks × 9 signals, description-audit diffs.
6. **Prioritized backlog** — "fix this week / this quarter / don't bother", with the 5 changes that most improve first-run success.
7. **Evidence pack** — raw JSON, screenshots, timings, credit ledger.

---

## 10. Threats to validity (stated up front, not buried)

- **Single evaluator** → expert review, not a usability study. Mitigation: heuristics + cognitive walkthrough are valid with 1 expert; SUS/TLX numbers labelled *indicative*, not benchmarked against a user population, unless we recruit 5–8 naive testers (optional add-on, +2 days).
- **No oracle for LTM output.** Only independent sources are coarser (ERA5) or point-based (stations). Mitigation: metamorphic invariants do the heavy lifting; ground truth only bounds plausibility.
- **Async timing** varies with service load → all latency figures reported as distributions with timestamps, never a single number.
- **Coverage caveat** (E10): "partial success" means our correctness sample must be paired with a completeness measurement, or every accuracy claim is biased toward whatever did return.
- **Version drift.** Docs release notes stop at v1.0.0 while the product has moved on; we pin our observations to a timestamp and record the doc commit/HTML hash so findings are reproducible.
- **Ethics.** Black-box only, our own accounts, no enumeration, no load spikes, no publication of another customer's data or any credential. Cross-tenant check = one request, our own second key.

---

## 11. Open questions for the product team (asked, not assumed)

1. Is `heat_intelligence.temperature` Celsius or Fahrenheit? (docs say both — E8.1)
2. Which MCP auth is canonical: static Bearer API key, or OAuth with `analysis:run`/`analysis:read` (E6)?
3. Does polling `GET /v1/status/{id}` consume credits? Docs are silent, and the quickstart polls every 5 s for up to 10 min.
4. Is `wait_for_completion` on MCP tools synchronous server-side? If so, what is the timeout and what does a timeout return?
5. Is the `20 m` catalog available for Phoenix/NYC, i.e. will our finest-granularity tests run at all?
6. Is there an OpenAPI document internally that simply isn't published (E4)?
7. What is the intended accuracy claim — °C RMSE, or relative ranking? The whole D2 weighting changes with the answer.

---

## 12. Access status

**Resolved.** `.env` now provides `FORTYGUARD_API_KEY`; rounds 1–4 executed — 9 billable activities over ~110 HTTP requests including polling, **39,720 credits**, results in `evidence/` and `FINDINGS.md`.

**Security incident to disclose.** One probe in round 1 (`key-in-query-string`) printed the key inside a logged URL. The value was scrubbed from every evidence artifact immediately (`<REDACTED_KEY>`), it never entered the plan or findings documents, and no third party was exposed — but it is in the transcript of this session, so **the key should be rotated by the account owner once the evaluation is done**. The harness now never logs request URLs containing credentials.

**Dashboard access resolved (round 5).** An exported browser cookie jar (`current_session_cookies/current_session_cookies.json`, 3 cookies) replays a valid Firebase session against the dashboard's real backend, `https://dashboard-api.apps.fortyguard.com` — a host the public docs never mention. Verified: `GET /auth/verify-access` → `200 {"role":"paid",…}`, same call without cookies → `401 "Session token not found in request cookies"`, tampered signature → `401 "Invalid or revoked session token"`. The SPA then renders (1,073 elements, map + sidebar). Evidence and script: `evidence/round5/`, `scripts/explore_dashboard.py`, `scripts/dashboard_ui_probe.mjs`, `scripts/dashboard_ui_matrix.mjs`. Round 5 was strictly read-only (GET only): **0 credits spent, 0 billable activities**, so the ledger stays at 39,720 / 960,280 remaining.

**Session material handling.** The jar contains a live `session_token` (1 h) and `session_refresh_token` (valid to 2027-12-27). Both are non-HttpOnly (F22). Only cookie *names and lengths* are recorded; no cookie value is written into any evidence artifact, plan or findings document. The account owner should **sign out all sessions** (or revoke refresh tokens) once the evaluation ends, exactly as recommended for the API key, and delete `current_session_cookies/` afterwards.

**Access verdict resolved with two-account probe (round 6b):** Cross-tenant BOLA on heatmap objects (`/heatmaps/{id}`) remains verdict-limited by status codes alone: non-owner gets `500 "Domain not found"`, no read achieved. However, the `X-Account-Id` header BOLA is confirmed critical — the API trusts this header and enables cross-tenant data access in both directions via `/activity/user-stats` (F36). The `account-id` filter for credits is silently ignored (F35), returning identical results for all values. The dashboard is fully evaluable via exported cookie jar (round 5): valid session → `200`, no cookies → `401`, tampered token → `401`; 0 credits consumed, ledger at 39,720 / 960,280 remaining.

**Security incident:** key-in-query-string from round 1 (see §12). Key rotated post-evaluation.

**Round 6b (two-account) results — now testable:**
- F31 blank-deep-link proof: cold-load four routes render genuinely empty pages (overlaid proof + hash match to round-5 whites); reload recovers to `/map`.
- F32 cross-tenant BOLA: non-owner always gets 500 on `/heatmaps/{id}`, no read achieved; per-account endpoints differ; shared `/voting/submissions` is identical; credits barrier and `X-Account-Id` header override pending.
- F33 WCAG 2.2 AA: authenticated map page has 4 violation types, 1209 elements (axe); login page has 5 violation types, 80 elements — both have real defects.
- F34 MCP OAuth model mismatch: docs say static Bearer key; server implements OAuth 2.1 + Auth0 dynamic registration; `credit_balance` tool undocumented; dev Auth0 tenant fronting production.
- F35 — S2 — Credits barrier silently ignored: `GET /activity/get-credits?account-id=...` returns identical `200 114B` with sha `038f77b75d748cb4` for all account-id combinations (own, other, fake). The `account-id` filter has no effect; the 960,280-credit balance reported by the API is invisible in the product. Customers cannot see their real spend in the UI.
- F36 — S2 — Critical cross-tenant BOLA via `X-Account-Id` header: `GET /activity/user-stats` with `X-Account-Id: acc#sflQyqyHFX` (as account A) returns account B's data (sha `979faf11c482c0a9`), and vice versa. The API **trusts the client-supplied `X-Account-Id` header**, enabling cross-tenant data access in both directions. This is a critical BOLA vulnerability: caller A can impersonate B and read B's user stats, and caller B can impersonate A. The effective isolation is far weaker than the per-account endpoint differences suggest.

Everything else — satellite, street view, routing, monitors, 20 m, 429 policy, MCP golden set, ground truth — is unblocked and merely unexecuted.

---

## 13. First 10 concrete actions once the key lands

1. `GET /v1/status/nonexistent` → 404 vs 401 vs 500 envelope; record exactly.
2. `POST /v1/heatmap` on the docs' own NYC example verbatim, unmodified → does the copy-paste example work? (docs credibility, D4)
3. Same heatmap with `filter_type` 1/2/3/4 at fixed AOI → invariant family §7.4.3–7.4.6.
4. Repeat #2 three times → determinism k=3.
5. `heat_intelligence` with 82.4 and with 28.0 as `temperature` → settles the °C/°F question empirically (S1 if ambiguous).
6. Large AOI with `?result_delivery=links` → signed URLs, second-decode trap.
7. CORS re-test with a valid key (E3) → confirms or clears the browser-integration finding.
8. Two-key cross-tenant `activity_id` read → isolation verdict. *Now informed by F35/F36: the `X-Account-Id` header enables cross-tenant reads; the object-level `/heatmaps/{id}` returns 500 for non-owners.
9. MCP raw JSON-RPC `initialize`/`tools/list`/`tools/call env_params` → catalog truth vs docs, and which auth actually works. *Verified: `api-key` header required; Bearer key rejected; dev Auth0 tenant fronting production.
10. Dashboard login as a new user **via exported cookie session** — executed in round 5 across 7 routes; blocked-render and blank-deep-link defects recorded (F21, F28, F31). Automated axe WCAG scan completed (F33): map page 4 violation types/1209 elements, login page 5 violation types/80 elements.

**Round-5+6 execution note:** items 1–7 and 9 are done (rounds 1–4). Item 8 is informed by two-account probe (F35/F36). Item 10 is fully done at the session/render level with read-only verification (0 credits consumed).

---

*Prepared from live observation on 2026-11-20: 28 documentation routes rendered, 4 API endpoints probed unauthenticated, MCP endpoint and its OAuth metadata inspected, both Angular bundles analysed, axe WCAG scan executed, two-account BOLA probe executed. No authenticated request was made and no customer data was accessed beyond the single exported cookie jar.*
