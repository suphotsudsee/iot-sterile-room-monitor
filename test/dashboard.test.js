const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

class Element {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.children = [];
    this.classes = new Set();
    this.classList = {
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)
    };
    this.style = { setProperty() {} };
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  appendChild(child) { this.children.push(child); }
  addEventListener() {}
  removeAttribute(name) { delete this[name]; }
}

async function dashboard(fetchResponse, timeoutMs = 30000) {
  const nodes = new Map();
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: element, createElement: () => new Element() },
    location: { origin: "http://localhost", hostname: "localhost" },
    URLSearchParams, AbortController,
    AbortSignal: { timeout: () => AbortSignal.timeout(timeoutMs), any: AbortSignal.any },
    fetch: (url, options) => url === "/api/me"
      ? Promise.resolve(Response.json({ error: "Login required" }, { status: 401 }))
      : fetchResponse(url, options)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  element("#monthPicker").value = "2026-10";
  element("#hospitalSelect").value = "h1";
  element("#roomSelect").value = "room1";
  // Selector layout is covered by the real-browser check; these tests exercise loading.
  context.renderSelectors = () => {};
  vm.runInContext('state.rooms = [{ id: "room1", name: "Room 1", hospitalId: "h1" }]', context);
  context.showApp(true);
  return { context, element };
}

function reading(temperature = 23) {
  return { temperature, humidity: 50, roomId: "room1", timestamp: "2026-10-06T03:00:00Z", localDate: "2026-10-06" };
}

test("bootstrap failure leaves visible date grids and a retryable error", async () => {
  const { context, element } = await dashboard(async () => Response.json({ error: "database unavailable" }, { status: 500 }));
  await context.refreshAll();
  assert.equal(element("#tempGrid").children.length, 192);
  assert.equal(element("#humidityGrid").children.length, 192);
  assert.match(element("#dashboardMessage").textContent, /database unavailable/);
  assert.equal(element("#retryDashboardButton").classes.has("hidden"), false);
  assert.equal(element("#appView").classes.has("hidden"), false);
});

test("pending and successful readings display grids then daily values and summary", async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const { context, element } = await dashboard(() => pending);
  const loading = context.loadDashboard();
  assert.equal(element("#tempGrid").children.length, 192);
  complete(Response.json({ readings: [reading()] }));
  await loading;
  assert.equal(element("#maxTemp").textContent, "23.0");
  assert.equal(element("#avgRh").textContent, "50.0");
  assert.equal(element("#tempGrid").children.filter(cell => cell.children.some(child => child.className === "reading normal")).length, 1);
  assert.equal(element("#dashboardNotice").classes.has("hidden"), true);
});

test("empty readings are distinct from request errors", async () => {
  const { context, element } = await dashboard(async () => Response.json({ readings: [] }));
  await context.loadDashboard();
  assert.match(element("#dashboardMessage").textContent, /ไม่พบข้อมูล/);
  assert.equal(element("#dashboardNotice").classes.has("error"), false);
  assert.equal(element("#maxTemp").textContent, "-");
});

test("readings timeout is visible rather than leaving the loading message", async () => {
  const { context, element } = await dashboard((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), 10);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await context.loadDashboard();
    assert.match(element("#dashboardMessage").textContent, /30 วินาที/);
    assert.equal(element("#deviceStatus").textContent, "โหลดข้อมูลไม่สำเร็จ");
  } finally {
    clearTimeout(keepAlive);
  }
});

test("expired sessions return to login with an explanation", async () => {
  const { context, element } = await dashboard(async () => Response.json({ error: "Login required" }, { status: 401 }));
  await context.loadDashboard();
  assert.equal(element("#appView").classes.has("hidden"), true);
  assert.match(element("#loginError").textContent, /เข้าสู่ระบบใหม่/);
});

test("older readings responses cannot replace a newer selection", async () => {
  const responses = [];
  const { context, element } = await dashboard(() => new Promise(resolve => responses.push(resolve)));
  const old = context.loadDashboard();
  const latest = context.loadDashboard();
  responses[1](Response.json({ readings: [reading(24)] }));
  await latest;
  responses[0](Response.json({ readings: [reading(21)] }));
  await old;
  assert.equal(element("#maxTemp").textContent, "24.0");
});
