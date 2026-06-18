const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "readings.json");
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === "true";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(SEED_DEMO_DATA ? seedReadings() : [], null, 2), "utf8");
  }
}

function seedReadings() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const count = new Date(y, m + 1, 0).getDate();
  const readings = [];
  for (let d = 1; d <= Math.min(count, now.getDate()); d += 1) {
    const temp = 22 + Math.sin(d / 2) * 1.5 + (d % 9 === 0 ? 3.6 : 0);
    const humidity = 46 + Math.cos(d / 3) * 7 + (d % 11 === 0 ? 19 : 0);
    readings.push({
      id: `demo-${y}-${m + 1}-${d}`,
      deviceId: "ESP-DEMO-01",
      temperature: Number(temp.toFixed(1)),
      humidity: Number(humidity.toFixed(1)),
      timestamp: new Date(y, m, d, 8, 0, 0).toISOString()
    });
  }
  return readings;
}

async function loadReadings() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveReadings(readings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(readings, null, 2), "utf8");
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  if (url.pathname === "/api/health") {
    return json(res, 200, { ok: true, service: "iot-sterile-room-monitor" });
  }

  if (url.pathname === "/api/readings" && req.method === "GET") {
    const selectedMonth = url.searchParams.get("month") || monthKey(new Date());
    const readings = await loadReadings();
    return json(res, 200, {
      month: selectedMonth,
      readings: readings.filter(item => {
        const dt = new Date(item.timestamp);
        return Number.isFinite(dt.getTime()) && monthKey(dt) === selectedMonth;
      })
    });
  }

  if (url.pathname === "/api/readings" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "Invalid JSON body" });
    }

    const temperature = Number(payload.temperature ?? payload.temp);
    const humidity = Number(payload.humidity ?? payload.rh);
    const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity) || !Number.isFinite(timestamp.getTime())) {
      return json(res, 400, { error: "Required: temperature, humidity, optional timestamp" });
    }

    const readings = await loadReadings();
    const reading = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      deviceId: String(payload.deviceId || payload.device || "ESP-UNKNOWN"),
      temperature: Number(temperature.toFixed(2)),
      humidity: Number(humidity.toFixed(2)),
      timestamp: timestamp.toISOString()
    };
    readings.push(reading);
    await saveReadings(readings.slice(-20000));
    return json(res, 201, { ok: true, reading });
  }

  return json(res, 404, { error: "API route not found" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    const data = await fs.readFile(filePath);
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    json(res, 500, { error: error.message || "Server error" });
  }
});

ensureDataFile()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Sterile room monitor running at http://localhost:${PORT}`);
      console.log("ESP POST endpoint: http://localhost:" + PORT + "/api/readings");
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
