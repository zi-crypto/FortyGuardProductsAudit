# FortyGuard Execution Findings Summary

## Controlled negative and security suite

The suite ran 20 bounded cases and retained redacted response prefixes, checksums, status codes, content types, elapsed time, and URL-leakage flags in `negative-security-results.json`.

Positive controls:

- Missing API key: HTTP 401 with an actionable missing-header message.
- Malformed API key: HTTP 401 with an invalid/unknown-key message.
- Missing required fields: HTTP 422 with field-level location.
- Invalid coordinates and unsupported heatmap granularity: HTTP 422.
- Malformed and unclosed GeoJSON: HTTP 400 with specific structural messages.
- Invalid report analysis and malformed routing timestamp: HTTP 422.
- A URL probe containing only the sentinel `REDACTED_TEST_ONLY` was rejected for missing header; the real API key was never placed in a URL.

Findings requiring vendor attention:

1. A string latitude was accepted and the environmental task completed. This indicates incomplete scalar-type enforcement at the REST boundary.
2. An empty environmental `analysis` list was accepted and completed. The contract should either reject it or define the default behavior explicitly.
3. An unknown heatmap field was silently ignored and the heatmap completed. The API should document whether unknown fields are allowed or reject them consistently.
4. A street-view horizontal angle of 361 was accepted although the documented valid range is 0–360.
5. Invalid date `2024-02-30` returned a generic HTTP 500 instead of a 4xx validation response.
6. Identical routing endpoints returned a generic HTTP 500 instead of a client-facing validation response.
7. A route request exceeding the documented 200 km straight-line limit was accepted and entered processing, indicating either a documentation defect or missing pre-validation.

Several accepted cases generated activities and therefore need explicit credit-accounting verification in the final vendor report.

## Remaining MCP chains

`mcp-remaining-results.json` contains compact, redacted results. The report chain submitted in 7.108 seconds, charged 8,600 credits, and completed through `report_read`. The routing chain submitted in 16.791 seconds, charged 3,500 credits, and completed through `temperature_routing_read`, preserving the Phoenix baseline route and thermal metrics.

The live MCP catalog contains no satellite-read or street-view-read tools. Satellite calls returned HTTP 200 without a usable activity ID or structured result in the captured response. A subsequent direct-shape probe again returned an empty structured value. A street-view direct-shape probe terminated with `ChunkedEncodingError: Response ended prematurely`. The catalog description says MCP omits embedded images but preserves classes, legends, dates, and metadata; the observed responses did not establish that contract reliably.
