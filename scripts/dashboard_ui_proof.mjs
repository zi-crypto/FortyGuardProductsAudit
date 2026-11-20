// Round 6d: proof that the blank deep links are genuinely empty, not a capture
// artifact. For each blank route: cold navigation (cache disabled), plain shot,
// then an injected full-viewport overlay shot. If the overlay appears, rendering
// and screenshotting work and the empty page is the product's own state.
// Also enumerates the real navigation controls on /map, since <app-root> is not
// the mount node and the sidebar has no Activity link.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = process.env.CDP_PORT || "9222";
const OUT = "evidence/round6";
const SHOTS = path.join(OUT, "shots");
const DASH = "https://dashboard.fortyguard.com";
const ROUTES = ["/activity", "/monitoring", "/routing", "/map"];
const JAR = "current_session_cookies/current_session_cookies.json";

const jar = JSON.parse(fs.readFileSync(JAR, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

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

const STATE = `(() => {
  const ng = document.querySelector('[ng-version]');
  return {
    url: location.href,
    ng_version: ng ? ng.getAttribute('ng-version') : null,
    nodes: document.querySelectorAll('*').length,
    body_children: document.body.children.length,
    body_html_len: document.body.innerHTML.trim().length,
    text_len: document.body.innerText.trim().length,
    bg: getComputedStyle(document.body).backgroundColor,
    scripts: document.querySelectorAll('script[src]').length,
    canvas: document.querySelectorAll('canvas').length,
    viewport: [innerWidth, innerHeight],
  };
})()`;

const OVERLAY = `(() => {
  const d = document.createElement('div');
  d.id = 'capture-proof';
  d.style.cssText = 'position:fixed;inset:0;background:#c1121f;color:#fff;font:30px/1.5 sans-serif;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2147483647;text-align:center;padding:40px';
  d.innerHTML = '<div>CAPTURE-PROOF</div><div>' + location.pathname + '</div>' +
    '<div style="font-size:20px">nodes=' + document.querySelectorAll('*').length +
    ' text=' + document.body.innerText.trim().length +
    ' ng=' + (document.querySelector('[ng-version]')?.getAttribute('ng-version') || 'none') + '</div>';
  document.body.appendChild(d);
  return !!document.getElementById('capture-proof');
})()`;

const CONTROLS = `(() => {
  const els = [...document.querySelectorAll('a,button,[role=button],[role=menuitem],li')];
  return els.map(e => ({
    tag: e.tagName,
    text: (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
    href: e.getAttribute('href'),
    role: e.getAttribute('role'),
    aria: e.getAttribute('aria-label'),
  })).filter(x => x.text || x.href || x.aria).slice(0, 80);
})()`;

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable"); await cdp.send("Network.enable"); await cdp.send("Runtime.enable"); await cdp.send("Log.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const c of jar) {
    await cdp.send("Network.setCookie", {
      name: c.name, value: c.value, domain: c.domain, path: c.path || "/",
      secure: !!c.secure, httpOnly: !!c.httpOnly,
      sameSite: c.sameSite === "no_restriction" ? "None" : c.sameSite === "lax" ? "Lax" : "Strict",
      expires: c.expirationDate ? Math.floor(c.expirationDate) : undefined,
    });
  }

  const rows = [];
  for (const route of ROUTES) {
    const cases = route === "/map" ? ["cold", "cold-reload"] : ["cold"];
    for (const mode of cases) {
      const slug = `${route.replace(/[^a-z0-9]+/gi, "_")}_${mode}`;
      const start = cdp.events.length;
      await cdp.send("Page.navigate", { url: DASH + route });
      await sleep(4000);
      if (mode === "cold-reload") { await cdp.send("Page.reload", { ignoreCache: true }); }
      await sleep(11000);

      const ev = cdp.events.slice(start);
      const doc = ev.filter((m) => m.method === "Network.responseReceived" && m.params.type === "Document")
        .map((m) => ({ status: m.params.response.status, url: m.params.response.url }));
      const scripts = ev.filter((m) => m.method === "Network.responseReceived" && m.params.type === "Script")
        .map((m) => m.params.response.status);
      const errors = [...new Set(ev.filter((m) => m.method === "Runtime.exceptionThrown")
        .map((m) => (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").split("\n")[0].slice(0, 180)))];
      const consoleErrors = [...new Set(ev.filter((m) => m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
        .map((m) => m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 180)))];

      const { result: st } = await cdp.send("Runtime.evaluate", { expression: STATE, returnByValue: true });
      const plain = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64");
      fs.writeFileSync(path.join(SHOTS, `proof_${slug}_plain.png`), plain);

      const { result: injected } = await cdp.send("Runtime.evaluate", { expression: OVERLAY, returnByValue: true });
      await sleep(500);
      const over = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64");
      fs.writeFileSync(path.join(SHOTS, `proof_${slug}_overlay.png`), over);
      await cdp.send("Runtime.evaluate", { expression: "document.getElementById('capture-proof')?.remove()" });
      await sleep(200);

      const row = {
        route, mode, landed_on: st.value.url, state: st.value,
        empty_document: st.value.text_len === 0 && st.value.body_html_len < 4000,
        doc_responses: doc, script_statuses: scripts,
        exceptions: errors, console_errors: consoleErrors,
        plain_png: { file: `shots/proof_${slug}_plain.png`, bytes: plain.length, sha256: sha(plain).slice(0, 16) },
        overlay_png: { file: `shots/proof_${slug}_overlay.png`, bytes: over.length, sha256: sha(over).slice(0, 16) },
        overlay_injected: injected.value === true,
        overlay_rendered: sha(over) !== sha(plain),
      };
      rows.push(row);
      console.log(`\n### ${route} [${mode}] -> ${row.landed_on}`);
      console.log(`   ng=${st.value.ng_version} nodes=${st.value.nodes} text=${st.value.text_len} bodyHTML=${st.value.body_html_len} canvas=${st.value.canvas}`);
      console.log(`   doc=${JSON.stringify(doc)} scripts=${scripts.join(",")}`);
      console.log(`   overlay injected=${row.overlay_injected} rendered=${row.overlay_rendered} plain=${plain.length}B sha=${row.plain_png.sha256}`);
      for (const e of errors.slice(0, 3)) console.log("   EXC:", e.slice(0, 150));
      for (const e of consoleErrors.slice(0, 3)) console.log("   ERR:", e.slice(0, 150));
    }
  }

  // What navigation actually exists on /map?
  await cdp.send("Page.navigate", { url: DASH + "/map" });
  await sleep(12000);
  const { result: ctl } = await cdp.send("Runtime.evaluate", { expression: CONTROLS, returnByValue: true });
  const links = ctl.value.filter((c) => c.href || c.role === "menuitem" || /heatmap|route|demo|setting|profile|update|feedback/i.test(c.text));
  console.log("\n### /map navigation controls");
  for (const c of links.slice(0, 30)) console.log("  ", JSON.stringify(c));

  const demo = ctl.value.find((c) => /demo heatmaps/i.test(c.text));
  let clickResult = null;
  if (demo) {
    const expr = `(() => {
      const els = [...document.querySelectorAll('a,button,[role=button],[role=menuitem],li')];
      const el = els.filter(e => e.children.length === 0 && /demo heatmaps/i.test((e.innerText||'').trim())).pop();
      if (!el) return { clicked: false };
      el.click();
      return { clicked: true, tag: el.tagName };
    })()`;
    clickResult = (await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;
    await sleep(7000);
    const { result: after } = await cdp.send("Runtime.evaluate", { expression: STATE, returnByValue: true });
    const shot = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64");
    fs.writeFileSync(path.join(SHOTS, "proof_inapp_demo.png"), shot);
    clickResult.after = after.value;
    console.log("\n### in-app 'Demo Heatmaps' click:", JSON.stringify(clickResult));
  }

  fs.writeFileSync(path.join(OUT, "blank_proof.json"), JSON.stringify({
    captured_at_utc: new Date().toISOString(), chrome: ver.Browser, cache_disabled: true,
    rows, nav_controls: links.slice(0, 40), inapp_demo_click: clickResult,
  }, null, 2));
  console.log("\nwrote", path.join(OUT, "blank_proof.json"));
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
