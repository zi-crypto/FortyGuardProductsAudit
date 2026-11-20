# FortyGuard Product Evaluation

**Perspective:** New US customer

**Common test location:** Phoenix, Arizona, United States

**Evaluation date:** 2026-11-20

## Overall assessment

FortyGuard demonstrated substantial functional breadth and a working asynchronous architecture. The REST API successfully completed environmental parameters, heatmap, Heat Intelligence, satellite segmentation, street-view segmentation, and temperature-aware routing workflows. The MCP surface successfully completed environmental parameters, Heat Intelligence, and routing workflows, and its heatmap submit/read chain preserved structured statistics and cross-surface values.

The strongest positive result is cross-surface baseline consistency. REST and MCP returned matching Phoenix heatmap statistics and environmental values, and three identical REST environmental requests produced identical normalized result checksums. Authentication errors were clear, malformed GeoJSON errors were actionable, and generated activity IDs could not be read when the ID did not exist.

The main customer risks are contract strictness, temporal provenance, and MCP reliability. Several invalid REST inputs were accepted and completed, including a string latitude, empty analysis, unknown fields, and an out-of-range street-view angle. Invalid dates and identical routing endpoints produced generic HTTP 500 responses. A request beyond the documented 200 km routing limit was accepted. Heat Intelligence displayed 12:00 even though the upstream heatmap request was for 14:00. MCP satellite and street-view responses did not provide a stable, usable structured result in the captured runs, and the public catalog does not expose corresponding read tools.

**Recommendation:** Do not treat the products as production-ready without a contract-hardening pass and a documented correction to temporal and MCP result semantics. The core capabilities are promising, but the current behavior creates avoidable integration, billing, and interpretation risk for a new customer.

## Severity-ranked findings

### High — Heat Intelligence time lineage is ambiguous

A Phoenix Heat Intelligence report generated from a 14:00 upstream scenario displayed `2024-07-15 12:00` in its report metadata. The REST documentation and report semantics also mix Fahrenheit and Celsius wording. The endpoint documentation does not expose a controllable report time, while the MCP report schema accepts `date_time` metadata. A customer cannot currently determine whether 12:00 is a fixed report default, a timezone conversion, a source-data timestamp, or a stale metadata field.

**Impact:** A decision-maker could attribute the report to the wrong hour, especially during rapidly changing heat conditions.

**Recommendation:** Make the report's source timestamp explicit and machine-readable. Display requested local time, resolved timezone, UTC instant, source-data time, and any conversion. Reject or clearly label unsupported time inputs. Align all temperature descriptions to one unit contract.

### High — Invalid REST inputs can become billable tasks

The negative suite found that a string latitude, an empty environmental analysis list, an unknown heatmap field, and a street-view horizontal angle of 361 were accepted with HTTP 200 and completed activities. These behaviors conflict with the documented schemas or leave semantics undefined. Accepted cases generated activity IDs and may consume credits after completion.

**Impact:** Client bugs can produce paid tasks, silently ignored parameters, or results whose meaning is unclear.

**Recommendation:** Enforce strict request models before task creation. Reject wrong scalar types, empty lists, unknown fields, and out-of-range angles with 4xx responses. Return a stable problem-detail shape containing a type, field, reason, and remediation. Document any intentionally permissive behavior and confirm whether it is billable.

### High — MCP satellite and street-view result contracts are unreliable

The live MCP catalog contains `satellite` and `streetview`, but no corresponding read tools. The catalog says MCP omits embedded images while retaining segmentation classes, legends, dates, and metadata. In the captured runs, satellite returned HTTP 200 without a usable activity ID or structured result; a subsequent direct-shape probe returned an empty structured value. A street-view probe ended with a premature chunked-response termination.

**Impact:** An agent cannot reliably know whether the task completed, whether credits were charged, or how to retrieve the result. This prevents safe automation.

**Recommendation:** Choose one explicit contract: either make these tools synchronous and return stable structured metadata, or expose submit/read pairs with activity IDs. Add conformance tests for empty, truncated, and image-omitted responses. Return a clear failure object rather than HTTP 200 with no usable result.

### Medium — Routing validation does not match documented limits

The official limitations page documents a maximum 200 km origin-to-destination straight-line distance. A request beyond that distance was accepted and entered processing. Identical endpoints produced HTTP 500 instead of a client-facing validation response.

**Impact:** Customers cannot rely on documented bounds to prevent wasted credits or distinguish their error from a service failure.

**Recommendation:** Apply the 200 km and distinct-endpoint checks synchronously before task creation. Return 400 or 422 with the measured distance and applicable limit. Add boundary tests to release validation.

### Medium — Generic HTTP 500 for invalid date and route inputs

An invalid date (`2024-02-30`) returned HTTP 500. Identical routing endpoints also returned HTTP 500. These are client-input failures and should not appear as server faults.

**Impact:** Integrators may retry invalid requests, increasing latency and potentially creating duplicate work.

**Recommendation:** Normalize date/time and route validation at the API boundary. Use consistent 4xx responses and RFC 9457-style problem details. Include the field path and accepted format.

### Medium — Imagery provenance is incomplete

Satellite segmentation returned `image_year: null`, `image_date: null`, and `imagery_date_status: unavailable` for a requested historical date. Street-view returned a clear 2019-09-01 capture date. The two products therefore expose materially different provenance quality.

**Impact:** A customer may incorrectly interpret a requested analysis date as an imagery capture date.

**Recommendation:** Always distinguish requested analysis time, imagery capture date, imagery retrieval time, and unavailable provenance. Show a prominent “date not guaranteed” status in every visual result.

### Low — Documentation and encoding inconsistencies

The public MCP quickstart names nine tools while live discovery returned eleven, including `credit_balance` and `monitoring`. MCP text output rendered `W/m²` as `W/mÂ²`, although structured values remained usable. REST environmental enum names were not obvious from conceptual names and required a 422 response to discover the exact values.

**Recommendation:** Generate public tool documentation from the live catalog, publish exact enum values in copyable examples, and enforce UTF-8 end to end.

### Environment-specific observation — Dashboard blank rendering

The public dashboard login page rendered as a white viewport in the stateful cloud browser, even after a second view attempt. The saved HTML contained an empty `forty-root` element and JavaScript bundles, but no rendered text or interactive elements. This is reproducible in the evaluation browser environment, but it is not classified as a universal product defect because no independent end-user browser or authenticated dashboard account was available.

**Recommendation:** Reproduce with a clean external browser and capture console/network errors. If confirmed, prioritize a visible loading or failure state instead of an empty page.

## Test evidence

- REST heatmap activity: `0b01d2a0-047d-41a4-8f75-f7dafbc820f1`; 65 closed GeoJSON features; mean 39.7219°C.
- REST Heat Intelligence activity: `71b99739-5a53-4e51-9322-45f8b0adbb48`; 13-page PDF; SHA-256 `a3ab0a1e332e42545c071cb01be0b00766472cdc530fb44fd316fe6c54f1095b`.
- REST satellite activity: `f0e676da-fd73-4221-8f6d-218b294cfb05`; 350×350 output; three classes; imagery date unavailable.
- REST street-view activity: `ce25a683-15f8-4f3f-808a-91fa6b8f813e`; front six classes, back five classes; capture date 2019-09-01.
- REST routing activity: `d5cb68a8-a37b-48f8-84e1-41c8193c6f56`; 1.959 km; 2.51 minutes; mean thermal value 41.927°C.
- MCP environmental activity: `c9128c8e-af82-4905-b050-a62ad66b65fc`; 2,900 credits; values matched REST.
- MCP heatmap activity: `59d0f4dd-f7f4-40b5-a2bd-65a1f5901c0b`; 4,220 credits; terminal mean 39.7218523°C.
- MCP report activity: `5f61fa3a-ccbe-499e-b4de-3875970aa7ff`; 8,600 credits; completed through `report_read`.
- MCP routing activity: `08df94a9-9b20-4095-a0af-dbc0762558f4`; 3,500 credits; completed through `temperature_routing_read`.

Detailed redacted evidence is in [the evidence ledger](evidence-ledger.json), [the negative/security results](negative-security-results.json), [the MCP results](mcp-remaining-results.json), [the repeatability and isolation results](repeatability-isolation-results.json), and [the NOAA comparison](noaa-validity-comparison.json).

## Method and standards mapping

The evaluation used ISO/IEC 25010:2023 characteristics as the quality frame: functional suitability, performance efficiency, compatibility, interaction capability, reliability, security, flexibility, and safety. ISO/IEC 25040:2024 and ISO 9241-11 were applied through explicit context, task, outcome, evidence, and recovery measurements.

API testing covered authentication, contract validation, negative inputs, asynchronous state transitions, GeoJSON structure, unit/timezone metadata, bounded repeatability, activity-ID isolation, and response leakage. The approach follows OWASP API Security Top 10 principles, NIST API protection guidance, RFC 9457 problem-detail principles, and current academic practice in property-based, metamorphic, combinatorial, and REST API testing. Accessibility and dashboard testing were scoped against WCAG 2.2 and ISO 9241-11, but full task and keyboard testing was blocked by the blank unauthenticated render and lack of a test account.

The NOAA comparison used the Phoenix Sky Harbor ISD record at 21:00 UTC, corresponding to 14:00 local time in July. NOAA describes ISD as hourly/synoptic station observations with automated and manual quality-control history. The station air temperature was 40.0°C. This is a provenance sanity check only; it is not a claim that FortyGuard's modeled apparent-temperature value should equal an airport station air temperature.

## Priority remediation sequence

1. Harden all REST and MCP input validation before task creation and billing.
2. Define one versioned cross-product contract for date/time, timezone, units, activity lifecycle, and credit accounting.
3. Repair MCP satellite/street-view response and retrieval semantics, including stable structured output and explicit failure states.
4. Fix Heat Intelligence temporal lineage and Fahrenheit/Celsius documentation inconsistencies.
5. Replace generic client-input HTTP 500 responses with actionable 4xx problem details.
6. Align public documentation with live MCP discovery and add contract-conformance tests to release gates.
7. Reproduce and resolve the dashboard blank state in an independent browser, then complete authenticated task and WCAG testing.

## References

[1]: https://www.iso.org/standard/78176.html "ISO IEC 25010:2023 Systems and software engineering"
[2]: https://www.iso.org/standard/80767.html "ISO IEC 25040:2024 Quality evaluation process"
[3]: https://www.iso.org/standard/63500.html "ISO 9241-11:2018 Ergonomics of human-system interaction"
[4]: https://www.w3.org/TR/WCAG22/ "Web Content Accessibility Guidelines WCAG 2.2"
[5]: https://owasp.org/API-Security/ "OWASP API Security Project"
[6]: https://csrc.nist.gov/pubs/sp/800/228/ipd "NIST API protection guidance"
[7]: https://www.rfc-editor.org/rfc/rfc9457 "RFC 9457 Problem Details for HTTP APIs"
[8]: https://docs-api.fortyguard.com/docs/limitations "FortyGuard API Known Limitations"
[9]: https://docs-api.fortyguard.com/docs/mcp-tools "FortyGuard MCP Tools"
[10]: https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database "NOAA Integrated Surface Database"
