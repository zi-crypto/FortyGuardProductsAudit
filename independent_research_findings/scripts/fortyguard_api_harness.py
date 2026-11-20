#!/usr/bin/env python3
"""Bounded FortyGuard evaluation helpers.

This module intentionally does not run a load test and never prints secrets.
Use FORTYGUARD_API_KEY from the environment. The negative-case catalog is
provided for controlled execution against a test account.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

import requests

BASE_URL = os.getenv("FORTYGUARD_BASE_URL", "https://api.fortyguard.com")
ACTIVITY_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
SECRET_RE = re.compile(r"(?i)(api[-_]?key|authorization|bearer)\s*[:=]\s*[^,\s]+")


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    severity: str = "informational"


def redacted(value: Any) -> Any:
    """Recursively redact obvious credential fields before persistence."""
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if re.search(r"(?i)(api[-_]?key|authorization|token|secret|password)", k) else redacted(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redacted(v) for v in value]
    if isinstance(value, str):
        return SECRET_RE.sub(lambda m: m.group(1) + "=[REDACTED]", value)
    return value


def checksum(value: Any) -> str:
    payload = value if isinstance(value, (bytes, bytearray)) else json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def geojson_checks(obj: dict[str, Any]) -> list[Check]:
    out: list[Check] = []
    out.append(Check("FeatureCollection type", obj.get("type") == "FeatureCollection"))
    features = obj.get("features")
    out.append(Check("features array", isinstance(features, list)))
    for i, feature in enumerate(features or []):
        geom = feature.get("geometry", {}) if isinstance(feature, dict) else {}
        coords = geom.get("coordinates")
        out.append(Check(f"feature {i} geometry type", geom.get("type") in {"Polygon", "MultiPolygon"}))
        if geom.get("type") == "Polygon" and coords:
            ring = coords[0]
            out.append(Check(f"feature {i} ring closed", len(ring) >= 4 and ring[0] == ring[-1], severity="high"))
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        temp = next((v for k, v in props.items() if "temp" in k.lower()), None) if isinstance(props, dict) else None
        if temp is not None:
            out.append(Check(f"feature {i} temperature numeric", isinstance(temp, (int, float))))
    return out


def numeric_unit_timezone_checks(payload: dict[str, Any]) -> list[Check]:
    text = json.dumps(payload, ensure_ascii=False)
    checks = [
        Check("timezone present", bool(re.search(r"America/[A-Za-z_]+", text)), "Expected an IANA timezone where time is returned."),
        Check("units discoverable", bool(re.search(r"(?i)(celsius|fahrenheit|percent|mm|w/m|km)", text)), "Expected field names or metadata to state units."),
        Check("no NaN/Infinity", not bool(re.search(r"(?i)(NaN|Infinity|-Infinity)", text)), severity="high"),
    ]
    return checks


def validate_activity_id(activity_id: str) -> Check:
    return Check("activity ID UUID shape", bool(ACTIVITY_RE.fullmatch(activity_id)), activity_id)


def response_security_checks(response: requests.Response) -> list[Check]:
    body = response.text
    return [
        Check("no API key in URL", "api-key" not in response.url.lower() and "apikey" not in response.url.lower(), severity="high"),
        Check("no obvious credential leakage", not bool(SECRET_RE.search(body)), severity="high"),
        Check("content type declared", bool(response.headers.get("content-type"))),
    ]


def negative_case_catalog() -> list[dict[str, Any]]:
    """One-request-per-case catalog; caller must gate and rate-limit execution."""
    return [
        {"name": "missing required field", "mutation": "remove latitude"},
        {"name": "wrong scalar type", "mutation": "latitude='33.4484'"},
        {"name": "invalid coordinate", "mutation": "longitude=-181"},
        {"name": "malformed GeoJSON", "mutation": "polygon_aoi={'type':'Polygon'}"},
        {"name": "unclosed polygon", "mutation": "first coordinate != last coordinate"},
        {"name": "reversed/invalid polygon", "mutation": "self-intersecting ring"},
        {"name": "empty analysis", "mutation": "analysis=[]"},
        {"name": "invalid date", "mutation": "date='2024-02-30'"},
        {"name": "invalid time", "mutation": "time='25:61'"},
        {"name": "unsupported date window", "mutation": "documented out-of-range date"},
        {"name": "impossible route", "mutation": "origin/destination outside coverage"},
        {"name": "granularity boundary", "mutation": "minimum-1 and maximum+1"},
        {"name": "oversized area", "mutation": "just over documented AOI limit"},
        {"name": "unknown field", "mutation": "extra_field='probe'"},
    ]


def bounded_baseline_plan(repetitions: int = 3) -> dict[str, Any]:
    if not 1 <= repetitions <= 5:
        raise ValueError("Bounded harness allows 1-5 repetitions only.")
    return {"repetitions": repetitions, "sleep_between_requests_s": 2, "load_test": False, "compare": ["status", "shape", "units", "checksum", "credits"]}


if __name__ == "__main__":
    print(json.dumps({"base_url": BASE_URL, "negative_cases": negative_case_catalog(), "baseline": bounded_baseline_plan()}, indent=2))
