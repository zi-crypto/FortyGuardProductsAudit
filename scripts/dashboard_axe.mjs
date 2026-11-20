// Round 6c: axe-core WCAG 2.2 AA scan of the authenticated dashboard and the
// unauthenticated login page. axe-core is installed outside the project and
// injected into the live page, so nothing is added to the repo's dependencies.
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "9222";
const OUT = "evidence/round6";
const DASH = "https://dashboard.fortyguard.com";
const AXE_SRC = process.env.AXE_SRC || "/tmp/axe/node_modules/axe-core/axe.min.js";
const JAR = process.env.JAR || "current_session_cookies/current_session_cookies.json";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const jar = JSON.parse(fs.readFileSync(JAR, "utf8"));
const axeSource = fs.readFileSync(AXE_SRC, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
}

const RUN = `axe.run(document, {
  runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} },
  resultTypes: ['violations', 'incomplete', 'passes']
}).then(r => ({
  url: location.href,
  title: document.title,
  elements_tested: document.querySelectorAll('*').length,
  violations: r.violations.map(v => ({
    id: v.id, impact: v.impact, help: v.help,
    wcag: (v.tags || []).filter(t => /^wcag/.test(t)),
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 3).map(n => (n.target || []).join(' ')),
    sample: (v.nodes[0]?.failureSummary || '').split('\\n').slice(1, 3).join(' | ').slice(0, 300),
  })),
  passes: r.passes.length,
  incomplete: r.incomplete.map(i => ({ id: i.id, nodes: i.nodes.length })),
}))`;

async function scan(cdp, label, url, waitMs) {
  await cdp.send("Page.navigate", { url });
  await sleep(waitMs);
  const injected = await cdp.send("Runtime.evaluate", { expression: axeSource, returnByValue: false });
  if (injected.exceptionDetails) throw new Error("axe injection failed: " + JSON.stringify(injected.exceptionDetails).slice(0, 300));
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: RUN, awaitPromise: true, returnByValue: true, timeout: 120000,
  });
  if (exceptionDetails) throw new Error("axe run failed: " + JSON.stringify(exceptionDetails).slice(0, 300));
  const r = result.value;
  console.log(`\n### ${label} ${r.url} — ${r.violations.length} violation types, ${r.elements_tested} elements`);
  for (const v of r.violations) {
    console.log(`  [${v.impact}] ${v.id} (${v.nodes} nodes, ${v.wcag.join(",")}) ${v.help}`);
    if (v.targets.length) console.log(`      e.g. ${v.targets[0]}`);
  }
  return { label, ...r };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable"); await cdp.send("Network.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const c of jar) {
    await cdp.send("Network.setCookie", {
      name: c.name, value: c.value, domain: c.domain, path: c.path || "/",
      secure: !!c.secure, httpOnly: !!c.httpOnly,
      sameSite: c.sameSite === "no_restriction" ? "None" : c.sameSite === "lax" ? "Lax" : "Strict",
      expires: c.expirationDate ? Math.floor(c.expirationDate) : undefined,
    });
  }

  const map = await scan(cdp, "dashboard_map_authenticated", DASH + "/map", 12000);

  // Unauthenticated login page: clear the jar inside the browser and revisit.
  await cdp.send("Network.clearBrowserCookies");
  const login = await scan(cdp, "login_unauthenticated", DASH + "/login", 9000);

  const report = {
    captured_at_utc: new Date().toISOString(),
    chrome: ver.Browser,
    axe_core: JSON.parse(fs.readFileSync(path.dirname(AXE_SRC) + "/package.json", "utf8")).version,
    tags: TAGS,
    scans: [map, login],
  };
  fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(report, null, 2));
  console.log("\nwrote", path.join(OUT, "axe.json"));
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
