// Round 5b: drive headless Chrome over CDP (no npm deps; Node 24 global WebSocket)
// Injects the exported session cookies, loads the dashboard, records network
// statuses, console errors, a11y heuristics, a screenshot and the rendered text.
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "9222";
const OUT = "evidence/round5";
const DASH = "https://dashboard.fortyguard.com";
const TARGET_PATH = process.env.TARGET_PATH || "/map";

const jar = JSON.parse(fs.readFileSync("current_session_cookies/current_session_cookies.json", "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function version() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(500);
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function openSocket(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return new CDP(ws);
}

const A11Y_AUDIT = `(() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') ||
      (el.labels && el.labels.length ? el.labels[0].innerText : '') ||
      (el.innerText || '').trim()).slice(0, 60);
  const imgs = q('img');
  const buttons = q('button, [role=button], a[href]');
  const inputs = q('input, select, textarea');
  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.getAttribute('lang'),
    viewport: [innerWidth, innerHeight],
    nodes: document.querySelectorAll('*').length,
    iframes: q('iframe').map(f => f.src),
    img_total: imgs.length,
    img_missing_alt: imgs.filter(i => !i.hasAttribute('alt')).length,
    control_total: buttons.length,
    control_no_name: buttons.filter(b => !name(b)).length,
    input_total: inputs.length,
    input_no_label: inputs.filter(i => !(i.labels && i.labels.length) && !i.getAttribute('aria-label') && !i.getAttribute('placeholder')).length,
    h1: q('h1').map(h => h.innerText.trim()).slice(0, 3),
    headings: q('h1,h2,h3').map(h => h.tagName + ': ' + h.innerText.trim().slice(0, 50)).slice(0, 12),
    landmarks: { main: q('main').length, nav: q('nav').length, header: q('header').length, footer: q('footer').length },
    liveRegions: q('[aria-live]').length,
    langOnBody: document.body.getAttribute('lang'),
    textSample: document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 1800)
  };
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ver = await version();
  console.log("chrome:", ver.Browser);

  const pageTarget = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = await openSocket(pageTarget.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Inject the exported jar. Domain=.fortyguard.com so subdomains share it.
  for (const c of jar) {
    const r = await cdp.send("Network.setCookie", {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite === "no_restriction" ? "None" : c.sameSite === "lax" ? "Lax" : "Strict",
      expires: c.expirationDate ? Math.floor(c.expirationDate) : undefined,
    }).catch((e) => ({ ok: false, err: String(e) }));
    console.log(`setCookie ${c.name}:`, r && r.success === false ? `FAILED ${r.err || ""}` : "ok");
  }
  const stored = await cdp.send("Network.getCookies", { urls: [DASH] });
  console.log("cookies visible to page:", stored.cookies.map((c) => `${c.name}(len ${String(c.value).length})`).join(", "));

  const responses = [];
  cdp.ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      responses.push({ url: r.url, status: r.status, type: m.params.type, mime: r.mimeType });
    }
  });

  const t0 = Date.now();
  await cdp.send("Page.navigate", { url: DASH + TARGET_PATH });
  // Wait for the SPA to settle: network idle-ish + auth XHR completing.
  let settled = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: "document.readyState + '|' + location.pathname",
      returnByValue: true,
    });
    if (String(result.value).startsWith("complete") && Date.now() - t0 > 6000) { settled = result.value; break; }
  }
  const loadMs = Date.now() - t0;
  console.log("readyState|path after", loadMs, "ms:", settled);

  const { result: audit } = await cdp.send("Runtime.evaluate", { expression: A11Y_AUDIT, returnByValue: true });
  const { result: cookiesAfter } = await cdp.send("Runtime.evaluate", {
    expression: "document.cookie.split(';').map(s=>s.trim().split('=')[0]).filter(Boolean)",
    returnByValue: true,
  });
  console.log("readable via document.cookie:", cookiesAfter.value);

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, "dashboard_map.png"), Buffer.from(shot.data, "base64"));

  const { result: html } = await cdp.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
  fs.writeFileSync(path.join(OUT, "dashboard_map.html"), html.value);

  const consoleMsgs = cdp.events
    .filter((e) => e.method === "Runtime.consoleAPICalled" || e.method === "Log.entryAdded" || e.method === "Runtime.exceptionThrown")
    .map((e) => e.method === "Log.entryAdded"
      ? { kind: "log", level: e.params.entry.level, text: e.params.entry.text?.slice(0, 300) }
      : e.method === "Runtime.exceptionThrown"
        ? { kind: "exception", text: (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || "").slice(0, 300) }
        : { kind: "console", level: e.params.type, text: e.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300) })
    .filter((m) => m.level === "error" || m.level === "warning" || m.kind !== "log");

  const dashApi = responses.filter((r) => r.url.includes("fortyguard.com"));
  const report = {
    captured_at_utc: new Date().toISOString(),
    target: DASH + TARGET_PATH,
    load_ms: loadMs,
    audit: audit.value,
    document_cookie_names: cookiesAfter.value,
    responses_total: responses.length,
    responses_fortyguard: dashApi,
    failed_requests: responses.filter((r) => r.status >= 400),
    console: consoleMsgs.slice(0, 40),
  };
  fs.writeFileSync(path.join(OUT, "dashboard_ui.json"), JSON.stringify(report, null, 2));

  console.log("\n--- audit ---");
  console.log(JSON.stringify({ ...audit.value, textSample: audit.value.textSample?.slice(0, 500) }, null, 2));
  console.log("\n--- fortyguard responses ---");
  for (const r of dashApi) console.log(r.status, r.type, r.url.replace(DASH, ""));
  console.log("\n--- >=400 ---");
  for (const r of report.failed_requests) console.log(r.status, r.url.slice(0, 140));
  console.log("\n--- console errors/warnings ---");
  for (const c of consoleMsgs.slice(0, 12)) console.log(c.level || c.kind, ":", c.text?.slice(0, 200));
  console.log("\nwrote", path.join(OUT, "dashboard_ui.json"), "and dashboard_map.png");
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
