# FortyGuard Product Evaluation Plan

**Status:** Active execution; REST and initial MCP baseline tests completed  
**Evaluation context:** New-customer perspective, United States coverage  
**Reference city:** Phoenix, Arizona, United States  
**Prepared:** 2026-11-20

## What we are evaluating

The evaluation should treat FortyGuard as one product family with three user-facing entry points, not as three unrelated demos:

1. **Temperature Dashboard®** — the browser experience for a customer who wants to explore temperature intelligence without writing code.
2. **Temperature API®** — the developer experience for an engineer who needs reliable, well-documented, machine-readable temperature and environmental capabilities.
3. **FortyGuard Temperature MCP** — the agent/tool experience for a user who wants an AI client to discover and invoke the same capabilities safely and correctly.

The central question is not simply whether a request can return data. It is whether a new customer can understand the product, complete a realistic task, interpret the result, recover from failure, and trust the result enough to act on it.

## Standards baseline

The evaluation will use the current **ISO/IEC 25010:2023** product-quality model as the organizing framework. ISO describes it as a reference model for specifying, measuring, and evaluating ICT and software-product quality, with nine characteristics. We will map findings to functional suitability, performance efficiency, compatibility, interaction capability, reliability, security, maintainability, flexibility, and safety rather than producing a vague overall impression. [1]

For human-facing tasks, **ISO 9241-11:2018** is the usability anchor. It frames usability as an outcome of use in a specified context, rather than as a collection of visual preferences. This means every dashboard and MCP usability test must state the user, goal, environment, task, and expected outcome. [2]

For API security, the test design will use the current OWASP API Security Project and the risk-based lifecycle approach in **NIST SP 800-228 initial public draft**. The NIST guidance specifically calls out API inventory/visibility, authorization, authentication, unrestricted resource consumption, sensitive-information leakage, and input verification. We will test these defensively using owned credentials, bounded requests, and non-destructive inputs; we will not perform uncontrolled load testing or attempt to access other customers' data. [3] [4]

For HTTP error quality, **RFC 9457** provides a useful benchmark: errors should be machine-readable and human-actionable, with stable problem type information and detail that helps a client correct the request. FortyGuard does not need to implement RFC 9457 exactly to be evaluated against its principles, but inconsistent error shapes or opaque messages should be recorded as integration friction. [5]

The empirical usability method will combine realistic task scenarios, observation, task success, time on task, error count, and post-task perceived usability. Nielsen Norman Group identifies task success and time on task as common quantitative measures and recommends realistic tasks and representative users; a peer-reviewed systematic review also found substantial inconsistency in usability metrics and concluded that standardized evaluation and reporting improve comparison. [6] [7]

## Reconnaissance findings so far

### Documentation and product architecture

The public API documentation presents an API-key-authenticated service at `https://api.fortyguard.com`. Requests use an `api-key` header. The quickstart describes POST submissions that return an `activity_id`, followed by GET status checks until `Processing`, `Completed`, or `Failed`. It documents 400/422 validation errors, 401 authentication errors, 403 plan/authorization errors, 404 activity lookup issues, 429 rate limits, and 500 server errors. It also states that credits are deducted only after successful completion. [8] [9]

The exposed API catalog currently includes environmental parameters, heatmaps, satellite segmentation, street-view segmentation, Heat Intelligence reports, temperature-aware routing, monitoring operations, and status retrieval. The public documentation lists the core `/v1` paths as `/env_params`, `/heatmap`, `/satellite`, `/streetview`, `/heat_intelligence`, `/routing`, `/status/{activity_id}`, and monitor paths.

The MCP endpoint is `https://tos-mcp.app.fortyguard.com/mcp`, using remote MCP over HTTP / Streamable HTTP and `Authorization: Bearer <FORTYGUARD_API_KEY>`. The quickstart names nine tools: `env_params`, `heatmap`, `heatmap_read`, `report`, `report_read`, `satellite`, `streetview`, `temperature_routing`, and `temperature_routing_read`. The asynchronous relationships are explicit: submit with `heatmap`, `report`, or `temperature_routing`, then read with the corresponding read tool. [10] [11]

The MCP client guide says configurations have been validated with OpenAI Codex CLI, Cursor, and Claude Code. The evaluation should therefore test both connection setup and in-client behavior, not only raw MCP transport. [11]

### Access and early smoke test

The unauthenticated API is reachable. A non-destructive request to the API root and to `/v1/env_params` returned HTTP 401 with a clear message that the required `api-key` header is missing. This is a positive initial signal for authentication failure clarity, but it does not yet test valid authentication, authorization tiers, rate limits, data correctness, or response schemas.

The workspace `.env` did not contain a FortyGuard-looking variable, and the process environment did not expose one. A test key was subsequently supplied directly for this evaluation and was used transiently without writing it to disk or logs.

The first authenticated Phoenix `env_params` request returned HTTP 422 because the intuitive analysis names used in the exploratory payload (`apparent_temperature`, `relative_humidity`, and similar) were not the API's exact enum values. The response did provide a detailed allowed-value list, which made recovery possible but exposed a documentation/schema discoverability gap. After correcting the enum values, the request returned HTTP 200 in 4.82 seconds with an `activity_id`; the first status check completed in 4.40 seconds. The result included `America/Phoenix` timezone metadata, explicit Celsius and percent units in field names, point elevation, modeled solar-irradiance descriptions, and environmental values. This also shows that REST `env_params` behaves asynchronously in practice, while the MCP documentation describes `env_params` as a direct tool; cross-surface semantics should be tested explicitly.

The live MCP handshake also succeeded. The server identified itself as FortyGuard version 4.0.11 and accepted protocol version 2025-03-26. Tool discovery returned 11 tools rather than the nine named in the public quickstart: it additionally exposed a free read-only `credit_balance` tool and a `monitoring` tool. The discovered metadata marked `credit_balance` read-only and idempotent, and the free call returned a premium account with 957,380 available credits and zero credit cost. This is valuable for planning, but the documentation/catalog mismatch and the presence of paid/destructive monitoring operations make live tool discovery a required part of the final MCP evaluation.

The first paid REST capability sweep completed successfully. A minimal Phoenix heatmap submitted in 4.36 seconds, returned four `Processing`/`Completed` polls, and produced 65 closed GeoJSON polygons. Tile temperatures ranged from 39.697°C to 39.7523°C, with a mean of 39.7219°C; both `map_data` and aggregate `stats_data` were present. The Heat Intelligence report submitted in 4.60 seconds and completed after 17 polls. Its 13-page PDF downloaded successfully, but its metadata reported `2024-07-15 12:00` even though the input temperature came from the 14:00 heatmap request. The report also repeats the documentation's Fahrenheit/Celsius ambiguity. This is a high-priority lineage and time-semantics finding, not yet a confirmed computation error.

Satellite segmentation completed after two polls and returned a 350×350 image, three segment classes, three legend entries, and no imagery capture date (`imagery_date_status: unavailable`) despite a requested date. Street-view segmentation completed after two polls and returned both front and back views, six front classes, five back classes, and an image date of 2019-09-01. Temperature-aware routing completed after four polls and returned one selected route of 1.959 km and 2.51 minutes, with mean thermal exposure 41.927°C, peak 41.95°C, and `no_cooling_available: true`. These results validate the happy paths but also require follow-up testing of date provenance, spatial coverage, route alternatives, and report/heatmap temporal consistency.

The sandbox browser could navigate to the dashboard and documentation URLs, but the rendered pages appeared visually blank while text extraction still returned content. This is a sandbox observation only. It must be reproduced in a normal browser before being classified as a product defect.

The live MCP baseline now covers both a point-conditions call and an asynchronous heatmap chain. MCP `env_params` returned HTTP 200 / structured content in 10.233 seconds, preserved `America/Phoenix` and the explicit `2024-07-15T14:00:00-07:00` timestamp, and reported a 2,900-credit premium cost. Its values matched the REST baseline (for example apparent temperature 40.7°C, relative humidity 22.9%, and clear-sky GHI 926.59 W/m²). The text representation contained a UTF-8 mojibake rendering (`W/mÂ²`) even though the structured numeric result was usable. Contrary to the public description of `env_params` as direct, the live MCP result included an `activity_id` and a trace.

MCP `heatmap` returned a processing activity in 8.264 seconds, reserved 4,220 credits, and preserved activity ID `59d0f4dd-f7f4-40b5-a2bd-65a1f5901c0b`. The first zero-cost `heatmap_read` returned `processing`; the second terminal read returned `completed` after 14.692 seconds of read/polling elapsed time. It reported minimum 39.697°C, maximum 39.7523°C, mean 39.7218523°C, and standard deviation 0.0159700°C—matching the REST heatmap statistics within rounding. This confirms the basic MCP async contract and cross-surface semantic parity for this baseline, but not yet client-level tool selection or failure recovery.

The bounded negative/security suite covered 20 cases across authentication, environmental parameters, heatmap, satellite, street view, Heat Intelligence, and routing. Authentication failures were clear 401 responses, missing fields and malformed polygons identified the relevant field, and the API did not require or expose a real key in a URL. However, four material contract weaknesses were observed: a string latitude was accepted and completed; an empty `analysis` list was accepted and completed; an unknown heatmap field was silently ignored and the task completed; and a street-view horizontal angle of 361 was accepted and completed. A documented invalid date produced a generic HTTP 500 rather than a client validation error. Identical routing endpoints also produced a generic HTTP 500, while a request exceeding the documented 200 km straight-line limit was accepted and entered processing. These cases were retained in the evidence artifact and require severity-ranked vendor feedback because accepted invalid inputs can consume credits or create ambiguous results.

The remaining MCP capability sweep completed the report and routing chains. MCP `report` submitted in 7.108 seconds, charged 8,600 credits, and completed through `report_read`; MCP `temperature_routing` submitted in 16.791 seconds, charged 3,500 credits, and completed through `temperature_routing_read` with the same 1.959 km / 2.51 minute Phoenix baseline route. The live tool catalog has no satellite-read or street-view-read tools. Satellite returned an HTTP 200 response without an activity ID or usable structured result in the captured response, and a subsequent direct-shape probe again returned an empty structured result. A street-view probe encountered a premature chunked-response termination. This is a material MCP integration/reliability issue and must be distinguished from ordinary image omission: the catalog says MCP omits embedded images, but it should still return classes, legends, dates, and metadata in stable structured content.

Three identical REST `env_params` requests all completed successfully. Their normalized result checksums were identical, supporting deterministic repeatability for this historical Phoenix point, while completion elapsed time varied from 3.848 to 10.217 seconds. A generated-but-not-created activity ID returned HTTP 404 with a clear “No activity found” message, providing a bounded activity-isolation check without guessing another customer's identifier.

Dashboard reproduction was attempted in the stateful sandbox browser at the public login URL. The screenshot remained entirely white after navigation and a second view attempt; no interactive elements were exposed. The saved HTML contained an empty `forty-root` element plus Angular runtime/main bundles, and the body had no rendered text. This is reproducible in the evaluation browser environment, but it is not yet sufficient to call a universal dashboard defect because no independent end-user browser or authenticated account session was available.

For a bounded external-validity sanity check, the requested `2024-07-15 14:00` Phoenix local time was mapped to 21:00 UTC and compared with the NOAA/NCEI ISD record for Phoenix Sky Harbor station 722780-23183. The station air temperature was 40.0°C and dew point 16.1°C. FortyGuard's request supplied 35.0°C and returned modeled apparent temperature 40.7°C and heat index 33.4°C. This is not an accuracy claim: the FortyGuard input temperature was supplied by the evaluator, the station is airport-scale, and the modeled apparent-temperature field is not interchangeable with station air temperature. The comparison is useful only as a provenance/unit sanity check and reinforces the need for explicit source definitions in product outputs. The raw comparison and record checksum are saved separately. [12]

All executable API/MCP phases in the plan are now complete: happy paths, bounded negative validation, security probes, async chaining, repeatability, activity isolation, cross-surface comparison, and the limited external station sanity check. Dashboard task completion and full WCAG interaction testing remain blocked by the blank unauthenticated render and the absence of a permitted dashboard test account; these limitations are separated from the API/MCP conclusions in the vendor report.

## Evaluation design

### Phase 0 — Access, controls, and evidence capture

Before running paid or credit-consuming calls, record the plan, available credits, key scope, account role, and any documented rate or area limits. Use a dedicated test account or key if possible. Store the key only in an environment variable or secret store and redact it from logs.

Create a test ledger for every action with timestamp, product surface, user task, endpoint/tool, request shape, city/coordinates, date/time and timezone, activity ID, HTTP/MCP status, latency, credits if visible, result checksum, and evaluator notes. Save raw responses with secrets removed. This makes API and MCP findings reproducible and lets us distinguish a product defect from a transient service failure.

Use Phoenix as the common location because it is an intuitive heat-stress scenario and is within the stated US coverage. Use one fixed point and one small polygon for baseline repeatability. Keep historical dates and request parameters fixed when testing repeatability; separately test a current/future date to expose freshness and forecast semantics.

### Phase 1 — New-customer onboarding

For the dashboard, begin from the public login page and follow the sign-up, login, password-recovery, and Google-login paths only as permitted by the test account. Measure whether a new user can understand what the product does, identify the US-only scope, reach a useful Phoenix view, and tell what data is current, forecast, historical, modeled, or unavailable.

For the API, begin with only the documentation and key. Follow the quickstart literally, then repeat using a minimal custom Phoenix request. Record documentation ambiguities, copy/paste defects, mismatches between examples and schemas, undocumented required fields, and whether the first successful result is interpretable without reverse engineering.

For MCP, configure one supported client first, then a second if available. Measure time to connection, environment-variable clarity, whether the client discovers all nine tools, whether tool descriptions are sufficient for tool selection, and whether the first `env_params` request succeeds without manually reconstructing undocumented details.

### Phase 2 — Representative end-to-end tasks

Run the same user goals through the appropriate surfaces:

- **Point conditions:** “What are the environmental conditions at a Phoenix point for a specified date and hour?” Use dashboard exploration if available, API `env_params`, and MCP `env_params`.
- **Area heat risk:** “Which parts of this small Phoenix polygon are hottest during a specified period?” Test API heatmap submit/read, MCP heatmap/heatmap_read, and the corresponding dashboard workflow.
- **Written decision support:** “Produce a Heat Intelligence view for this location and explain what the result is useful for.” Test report generation, asynchronous retrieval, link handling, and dashboard presentation.
- **Visual context:** “What land-cover or street-level context is available at this point?” Test satellite and streetview behavior, imagery dates, missing coverage, and semantic-output readability.
- **Thermal routing:** “Compare route alternatives between two Phoenix points at a specified departure time.” Test routing submit/read, route geometry, duration, thermal metrics, selected-route explanation, and failure behavior.

For each task, use a neutral scenario and do not tell the evaluator which endpoint or tool to choose. This tests discoverability and product-level usefulness, not just endpoint compliance.

### Phase 3 — API contract, robustness, and security evaluation

Test valid requests first, then one variable at a time. Cover required-field omission, wrong types, malformed GeoJSON, invalid coordinates, reversed polygons, empty analysis lists, invalid date/time formats, unsupported date ranges, impossible origin/destination pairs, boundary granularity, oversized areas within documented limits, and unknown fields.

For every response, verify status code, content type, stable top-level shape, field types, units, timezone semantics, null/missing-data semantics, and whether errors identify the failing field. Verify that async polling has a bounded, documented strategy and that failed activities are terminal rather than silently retried forever.

Measure latency separately for submission and completion. Run a small repeated baseline series rather than a stress test. Compare identical requests for result consistency, activity-state consistency, and credit accounting. Test rate-limit behavior only within documented or explicitly approved limits.

Security checks should include missing, malformed, expired, and wrong-scope keys; whether keys appear in URLs or response bodies; whether signed artifact links are time-limited; whether one account can retrieve another activity ID; whether authorization differs correctly by plan; and whether error messages reveal secrets, internal paths, or excessive debug data. Keep all tests within the assigned account and use only IDs generated by the test run.

### Phase 4 — MCP-specific evaluation

Evaluate protocol and agent behavior separately. First test transport/authentication and tool discovery. Then test tool-selection accuracy using paraphrased user requests, ambiguous requests, missing required inputs, invalid inputs, and requests that should be refused or clarified rather than guessed.

For asynchronous tools, verify that the client preserves the activity identifier, calls the matching read tool, stops on failure, and presents a useful explanation of processing state. Verify that structured fields survive the MCP boundary without being flattened into misleading prose. Check whether the client makes unsupported assumptions about units, date/time zones, or Phoenix coverage.

Test prompt-injection-resistance in returned data and documents using harmless synthetic text only. The MCP client should treat tool output as data, not as instructions to reveal the API key, call unrelated services, or ignore user constraints.

### Phase 5 — Dashboard usability and accessibility

Use moderated, think-aloud task sessions for qualitative discovery and a small repeatable benchmark for quantitative comparison. Tasks should be realistic and neutrally worded. Record completion as success, partial success, failure, or abandonment; time on task; wrong turns; recoveries; help requests; visible system errors; and confidence in the final interpretation.

Check responsive behavior, keyboard navigation, focus order, visible focus, zoom/reflow, readable contrast, chart/map alternatives, loading and empty states, error recovery, copy/export behavior, and whether color is the only encoding of heat severity. These are not cosmetic checks: they affect whether a user can correctly complete the task and understand the result.

After each major task, use a short perceived-usability measure such as SUS for a fuller study or UMUX-Lite when session length is constrained. Report the instrument, sample, scoring method, and uncertainty; do not turn a tiny convenience sample into a population claim.

## Measurement and decision rules

The primary outcome is **task success in context**, not a single composite score. Secondary dimensions are time/efficiency, error recovery, result interpretability, reliability, performance, security, and scientific validity.

For binary task success, report the numerator and denominator and an exact or Wilson 95% confidence interval when the sample supports it. For time and latency, report median, interquartile range, and p95; use mean only when the distribution and missingness justify it. Report failures by category instead of hiding them inside an average.

Classify findings as:

- **Blocker:** prevents safe access, causes unauthorized disclosure, loses work/credits, or makes a core result materially misleading.
- **High:** prevents a new customer from completing a core task or creates a serious integration/reliability risk.
- **Medium:** causes repeated confusion, unnecessary manual work, or inconsistent interpretation but has a workaround.
- **Low:** polish or documentation issue with limited task impact.

Do not claim temperature accuracy from an API response alone. For a validity study, pre-register the comparison date/time, spatial and temporal matching method, units, and acceptance criteria, then compare against an authoritative observation source such as NOAA's Integrated Surface Database, which provides hourly and synoptic surface observations and documents quality-control processing, where the spatial/temporal resolution is appropriate. [12] Modeled urban microclimate outputs and station observations are not interchangeable; the report must distinguish agreement with observations from internal consistency and usefulness for decisions.

## What we need before execution

1. A FortyGuard test API key available as `FORTYGUARD_API_KEY` or another explicitly named variable in the actual workspace.
2. A dashboard test account or permission to create one, plus confirmation that sign-up and Google login are in scope.
3. The plan/tier and whether API/MCP calls consume credits in this evaluation.
4. Permission to run a bounded set of asynchronous calls and a small repeatability series.
5. Confirmation of which supported MCP client(s) should be treated as the reference customer path.
6. Any product-owner expectations for accuracy, latency, coverage, or severity thresholds.

## Recommended execution order

Start with one Phoenix `env_params` request because it is direct, cheap, and validates authentication, schema, units, and a baseline result. Then run one small heatmap end to end to validate asynchronous semantics. Next configure MCP and reproduce those two tasks through tool discovery. Only after those paths are stable should we spend credits on reports, segmentation, routing, and repeated robustness tests. Finally, run the dashboard tasks and cross-surface consistency checks.

This order minimizes wasted credits, creates a reproducible baseline, and tests the new-customer journey in the same sequence a careful evaluator would use: understand, authenticate, get one useful answer, expand to a meaningful workflow, then test limits and trustworthiness.

## References

[1]: https://www.iso.org/standard/78176.html "ISO/IEC 25010:2023 Systems and software engineering"
[2]: https://www.iso.org/standard/63500.html "ISO 9241-11:2018 Ergonomics of human-system interaction"
[3]: https://owasp.org/API-Security/ "OWASP API Security Project"
[4]: https://csrc.nist.gov/pubs/sp/800/228/ipd "NIST SP 800-228 Initial Public Draft Guidelines for API Protection"
[5]: https://www.rfc-editor.org/rfc/rfc9457 "RFC 9457 Problem Details for HTTP APIs"
[6]: https://www.nngroup.com/articles/usability-testing-101/ "Nielsen Norman Group Usability Testing 101"
[7]: https://pmc.ncbi.nlm.nih.gov/articles/PMC9438452/ "Systematic review of applied usability metrics within usability evaluation methods"
[8]: https://docs-api.fortyguard.com/docs/introduction "FortyGuard API Introduction"
[9]: https://docs-api.fortyguard.com/docs/quickstart "FortyGuard API Quickstart"
[10]: https://docs-api.fortyguard.com/docs/mcp-overview "FortyGuard MCP Overview"
[11]: https://docs-api.fortyguard.com/docs/mcp-quickstart "FortyGuard MCP Quickstart and Client Setup"
[12]: https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database "NOAA Integrated Surface Database"
