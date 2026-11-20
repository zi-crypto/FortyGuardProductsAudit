// Round 5c: dashboard UI route matrix. One CDP session, cookie-authenticated,
// visits each route, records render outcome + console errors + screenshot.
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "9222";
const OUT = "evidence/round5";
const DASH = "https://dashboard.fortyguard.com";
const ROUTES = (process.env.ROUTES || "/,/map,/activity,/monitoring,/routing,/mcp/connect,/login").split(",");
const SETTLE_MS = Number(process.env.SETTLE_MS || 9000);

const jar = JSON.parse(fs.readFileSync("current_session_cookies/current_session_cookies.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) this.events.push(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
}

const AUDIT = `(() => {
  const root = document.querySelector('app-root') || document.body;
  return {
    url: location.href,
    nodes: document.querySelectorAll('*').length,
    app_root_children: root.querySelectorAll('*').length,
    body_text_len: document.body.innerText.trim().length,
    text: document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 1200),
    title: document.title,
    lang: document.documentElement.getAttribute('lang'),
    canvas: document.querySelectorAll('canvas').length,
    controls_named: (() => {
      const els = Array.from(document.querySelectorAll('button,a[href],input,select,textarea'));
      const named = els.filter(e => (e.getAttribute('aria-label') || e.getAttribute('title') ||
        (e.labels && e.labels.length) || (e.innerText||'').trim() || e.getAttribute('placeholder')));
      return els.length ? named.length + '/' + els.length : '0/0';
    })(),
  };
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  console.log("chrome:", ver.Browser);
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

  let netLog = [];
  let errLog = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (r.url.includes("fortyguard")) netLog.push({ status: r.status, type: m.params.type, url: r.url });
    }
    if (m.method === "Runtime.exceptionThrown") {
      errLog.push({ kind: "exception", text: (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").split("\n")[0].slice(0, 240) });
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errLog.push({ kind: "console.error", text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 240) });
    }
  });

  const rows = [];
  for (const route of ROUTES) {
    netLog = []; errLog = [];
    const slug = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
    const t0 = Date.now();
    await cdp.send("Page.navigate", { url: DASH + route });
    await sleep(SETTLE_MS);
    const { result } = await cdp.send("Runtime.evaluate", { expression: AUDIT, returnByValue: true });
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `ui_${slug}.png`), Buffer.from(shot.data, "base64"));
    const row = {
      route, landed_on: result.value.url, ms: Date.now() - t0,
      nodes: result.value.nodes, app_root_children: result.value.app_root_children,
      blank: result.value.body_text_len === 0 && result.value.app_root_children < 3,
      text_len: result.value.body_text_len, controls_named: result.value.controls_named,
      canvas: result.value.canvas,
      api: [...new Set(netLog.filter((r) => r.url.includes("dashboard-api")).map((r) => `${r.status} ${r.url.replace("https://dashboard-api.apps.fortyguard.com", "")}`))],
      bad_status: netLog.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url.slice(0, 120)}`),
      errors: [...new Set(errLog.map((e) => e.text))].slice(0, 4),
      text: result.value.text.slice(0, 400),
    };
    rows.push(row);
    console.log(`\n### ${route} -> ${row.landed_on} (${row.ms} ms) nodes=${row.nodes} root=${row.app_root_children} blank=${row.blank} text=${row.text_len} controls=${row.controls_named}`);
    for (const a of row.api.slice(0, 6)) console.log("   api:", a);
    for (const b of row.bad_status.slice(0, 6)) console.log("   HTTP>=400:", b);
    for (const e of row.errors) console.log("   ERR:", e.slice(0, 150));
  }

  // Does a manual reload recover the blank render?
  await cdp.send("Page.navigate", { url: DASH + "/map" });
  await sleep(4000);
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(SETTLE_MS);
  const { result: after } = await cdp.send("Runtime.evaluate", { expression: AUDIT, returnByValue: true });
  console.log(`\n### reload /map -> nodes=${after.value.nodes} root=${after.value.app_root_children} text=${after.value.body_text_len} url=${after.value.url}`);
  const reloadShot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "ui_map_after_reload.png"), Buffer.from(reloadShot.data, "base64"));

  fs.writeFileSync(path.join(OUT, "dashboard_ui_matrix.json"), JSON.stringify({
    captured_at_utc: new Date().toISOString(), routes: rows,
    reload: { nodes: after.value.nodes, app_root_children: after.value.app_root_children, text_len: after.value.body_text_len, url: after.value.url },
  }, null, 2));
  console.log("\nwrote", path.join(OUT, "dashboard_ui_matrix.json"));
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
