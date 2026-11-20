// Round 6a: re-check the round-5 screenshot anomalies with better instrumentation.
// Per route: render timeline (1/3/6/10/15 s), DOM state, screenshot + sha256.
// If a route is empty, inject a visible overlay and capture again: if the overlay
// shows up, the screenshot pipeline works and the white page is genuinely empty.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = process.env.CDP_PORT || "9222";
const OUT = "evidence/round6";
const SHOTS = path.join(OUT, "shots");
const DASH = "https://dashboard.fortyguard.com";
const JAR = process.env.JAR || "current_session_cookies/current_session_cookies.json";
const ROUTES = (process.env.ROUTES || "/,/map,/activity,/monitoring,/routing,/login,/mcp/connect").split(",");
const SAMPLES = [1000, 3000, 6000, 10000, 15000];

const jar = JSON.parse(fs.readFileSync(JAR, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.onEvent = () => {};
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) this.onEvent(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
}

const STATE = `(() => {
  const root = document.querySelector('app-root');
  const cs = getComputedStyle(document.body);
  return {
    url: location.href,
    nodes: document.querySelectorAll('*').length,
    root_found: !!root,
    root_children: root ? root.querySelectorAll('*').length : null,
    root_html_len: root ? root.innerHTML.length : null,
    text_len: document.body.innerText.trim().length,
    html_len: document.documentElement.outerHTML.length,
    bg: cs.backgroundColor,
    canvas: document.querySelectorAll('canvas').length,
    controls: document.querySelectorAll('button,a[href],input,select,textarea').length,
    title: document.title,
  };
})()`;

const PROOF = (label) => `(() => {
  const d = document.createElement('div');
  d.id = 'capture-proof';
  d.textContent = 'CAPTURE-PROOF ${label} | app-root children=' +
    (document.querySelector('app-root')?.querySelectorAll('*').length ?? 'n/a') +
    ' | body text=' + document.body.innerText.trim().length;
  d.style.cssText = 'position:fixed;inset:0;background:#c1121f;color:#fff;font:28px sans-serif;' +
    'display:flex;align-items:center;justify-content:center;z-index:2147483647;text-align:center;padding:40px';
  document.body.appendChild(d);
  return document.getElementById('capture-proof') !== null;
})()`;

const CLICK_ACTIVITY = `(() => {
  const els = [...document.querySelectorAll('a,button,[role=button],li,span,div')];
  const hits = els.filter(e => e.children.length === 0 && /Search Activity/i.test(e.textContent || ''));
  if (!hits.length) return { clicked: false, candidates: els.filter(e => /activity/i.test(e.textContent || '')).length };
  const el = hits[hits.length - 1];
  el.click();
  return { clicked: true, tag: el.tagName, text: el.textContent.trim().slice(0, 60) };
})()`;

function sha(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  console.log("chrome:", ver.Browser, "| jar:", JAR.split("/").pop(), "| cookies:", jar.map((c) => c.name).join(","));

  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable"); await cdp.send("Network.enable"); await cdp.send("Runtime.enable"); await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const c of jar) {
    await cdp.send("Network.setCookie", {
      name: c.name, value: c.value, domain: c.domain, path: c.path || "/",
      secure: !!c.secure, httpOnly: !!c.httpOnly,
      sameSite: c.sameSite === "no_restriction" ? "None" : c.sameSite === "lax" ? "Lax" : "Strict",
      expires: c.expirationDate ? Math.floor(c.expirationDate) : undefined,
    });
  }

  let errors = []; let api = [];
  cdp.onEvent = (m) => {
    if (m.method === "Runtime.exceptionThrown") {
      errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").split("\n")[0].slice(0, 200));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 200));
    }
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (r.url.includes("dashboard-api")) api.push(`${r.status} ${r.url.replace("https://dashboard-api.apps.fortyguard.com", "")}`);
    }
  };

  const sample = async (route, ms) => {
    await sleep(ms);
    const { result } = await cdp.send("Runtime.evaluate", { expression: STATE, returnByValue: true });
    return result.value;
  };

  const rows = [];
  for (const route of ROUTES) {
    errors = []; api = [];
    const slug = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
    const timeline = [];
    let prev = 0;
    await cdp.send("Page.navigate", { url: DASH + route });
    for (const t of SAMPLES) { timeline.push({ t_ms: t, ...(await sample(route, t - prev)) }); prev = t; }

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(shot.data, "base64");
    fs.writeFileSync(path.join(SHOTS, `r6_${slug}.png`), buf);

    const last = timeline[timeline.length - 1];
    const blank = last.root_children !== null && last.root_children < 3 && last.text_len === 0;
    let proof = null;
    if (blank) {
      const { result: injected } = await cdp.send("Runtime.evaluate", { expression: PROOF(`${route} ${new Date().toISOString()}`), returnByValue: true });
      await sleep(400);
      const proofShot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const pb = Buffer.from(proofShot.data, "base64");
      fs.writeFileSync(path.join(SHOTS, `r6_${slug}_proof.png`), pb);
      proof = { overlay_injected: injected.value === true, same_pixels_as_blank: sha(pb) === sha(buf), bytes: pb.length };
      // Remove the overlay so later routes are unaffected.
      await cdp.send("Runtime.evaluate", { expression: "document.getElementById('capture-proof')?.remove()", returnByValue: true });
    }

    rows.push({
      route, slug,
      landed_on: last.url,
      stable: timeline[timeline.length - 1].nodes === timeline[timeline.length - 2].nodes &&
              timeline[timeline.length - 1].text_len === timeline[timeline.length - 2].text_len,
      blank, proof,
      screenshot: { file: `shots/r6_${slug}.png`, bytes: buf.length, sha256: sha(buf).slice(0, 16) },
      console_errors: [...new Set(errors)].slice(0, 4),
      api: [...new Set(api)].slice(0, 8),
      timeline,
    });
    const shape = timeline.map((s) => `${s.t_ms}ms:${s.nodes}n/${s.root_children}c/${s.text_len}t`).join(" ");
    console.log(`\n### ${route} -> ${last.url} blank=${blank} stable=${rows[rows.length - 1].stable}`);
    console.log("   timeline:", shape);
    if (proof) console.log("   proof overlay:", JSON.stringify(proof));
    for (const e of rows[rows.length - 1].console_errors) console.log("   ERR:", e.slice(0, 140));
  }

  // In-app navigation vs deep link: does clicking "Search Activity" from /map work?
  await cdp.send("Page.navigate", { url: DASH + "/map" });
  await sleep(10000);
  const { result: click } = await cdp.send("Runtime.evaluate", { expression: CLICK_ACTIVITY, returnByValue: true });
  await sleep(7000);
  const afterClick = (await cdp.send("Runtime.evaluate", { expression: STATE, returnByValue: true })).result.value;
  const clickShot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, "r6_inapp_activity.png"), Buffer.from(clickShot.data, "base64"));
  console.log("\n### in-app click 'Search Activity':", JSON.stringify(click.value), "->", afterClick.url, "nodes=", afterClick.nodes, "text=", afterClick.text_len);

  // Does a reload recover a blank deep link?
  await cdp.send("Page.navigate", { url: DASH + "/activity" });
  await sleep(9000);
  const beforeReload = (await cdp.send("Runtime.evaluate", { expression: STATE, returnByValue: true })).result.value;
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(12000);
  const afterReload = (await cdp.send("Runtime.evaluate", { expression: STATE, returnByValue: true })).result.value;
  const rlShot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, "r6_activity_after_reload.png"), Buffer.from(rlShot.data, "base64"));
  console.log("### /activity reload:", beforeReload.url, "nodes=", beforeReload.nodes, "text=", beforeReload.text_len,
              "->", afterReload.url, "nodes=", afterReload.nodes, "text=", afterReload.text_len);

  const report = {
    captured_at_utc: new Date().toISOString(),
    chrome: ver.Browser,
    jar: JAR,
    samples_ms: SAMPLES,
    routes: rows,
    inapp_click: { result: click.value, after: afterClick, shot: "shots/r6_inapp_activity.png" },
    activity_reload: { before: beforeReload, after: afterReload, shot: "shots/r6_activity_after_reload.png" },
  };
  fs.writeFileSync(path.join(OUT, "ui_matrix.json"), JSON.stringify(report, null, 2));
  console.log("\nwrote", path.join(OUT, "ui_matrix.json"));
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
