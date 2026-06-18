const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "saas-db.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@phoubon.in.th";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

const sessions = new Map();

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function deviceKey() {
  return `dev_${crypto.randomBytes(18).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

function nowIso() {
  return new Date().toISOString();
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
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

async function readJson(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        const index = item.indexOf("=");
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function cleanSessionUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    hospitalId: user.hospitalId
  };
}

async function loadDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    const hospitalId = id("hosp");
    const roomId = id("room");
    const key = deviceKey();
    const db = {
      hospitals: [
        {
          id: hospitalId,
          name: "โรงพยาบาลตัวอย่าง",
          code: "DEMO-HOSPITAL",
          createdAt: nowIso()
        }
      ],
      rooms: [
        {
          id: roomId,
          hospitalId,
          name: "ห้องเก็บเครื่องมือปราศจากเชื้อ",
          tempMin: 20,
          tempMax: 24,
          rhMin: 30,
          rhMax: 60,
          createdAt: nowIso()
        }
      ],
      devices: [
        {
          id: id("dev"),
          hospitalId,
          roomId,
          name: "ESP-STERILE-ROOM-01",
          deviceId: "ESP-STERILE-ROOM-01",
          deviceKey: key,
          lastSeenAt: null,
          createdAt: nowIso()
        }
      ],
      readings: [],
      alerts: [],
      users: [
        {
          id: id("usr"),
          hospitalId: null,
          name: "System Admin",
          email: ADMIN_EMAIL,
          passwordHash: hashPassword(ADMIN_PASSWORD),
          role: "system_admin",
          createdAt: nowIso()
        }
      ],
      auditLogs: []
    };
    await saveDb(db);
    console.log(`Default login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`Demo device key: ${key}`);
    return db;
  }
}

async function saveDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

async function withDb(fn) {
  const db = await loadDb();
  const result = await fn(db);
  await saveDb(db);
  return result;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function sameTenant(user, hospitalId) {
  return user.role === "system_admin" || user.hospitalId === hospitalId;
}

async function requireUser(req, res) {
  const sid = parseCookies(req).sid;
  const session = sessions.get(sid);
  if (!session || session.expiresAt < Date.now()) {
    if (sid) sessions.delete(sid);
    json(res, 401, { error: "Login required" });
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const db = await loadDb();
  const user = db.users.find(item => item.id === session.userId);
  if (!user) {
    sessions.delete(sid);
    json(res, 401, { error: "Login required" });
    return null;
  }
  return user;
}

function alertLevel(reading, room) {
  if (reading.temperature > 28 || reading.humidity > 70 || reading.temperature < room.tempMin || reading.humidity < room.rhMin) {
    return "critical";
  }
  if (reading.temperature > 26 || reading.humidity > 65) return "high";
  if (reading.temperature > room.tempMax || reading.humidity > room.rhMax) return "caution";
  return "normal";
}

function makeAlertMessage(reading, room, device) {
  const parts = [];
  if (reading.temperature < room.tempMin) parts.push(`Temp ต่ำ ${reading.temperature}°C`);
  if (reading.temperature > room.tempMax) parts.push(`Temp สูง ${reading.temperature}°C`);
  if (reading.humidity < room.rhMin) parts.push(`RH ต่ำ ${reading.humidity}%`);
  if (reading.humidity > room.rhMax) parts.push(`RH สูง ${reading.humidity}%`);
  return `${device.name}: ${parts.join(", ")}`;
}

async function handleAuth(req, res, url) {
  if (url.pathname === "/api/login" && req.method === "POST") {
    const payload = await readJson(req);
    const db = await loadDb();
    const user = db.users.find(item => item.email.toLowerCase() === String(payload.email || "").toLowerCase());
    if (!user || !verifyPassword(String(payload.password || ""), user.passwordHash)) {
      return json(res, 401, { error: "Email or password is incorrect" });
    }
    const sid = id("sid");
    sessions.set(sid, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return json(res, 200, { ok: true, user: cleanSessionUser(user) }, {
      "set-cookie": `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`
    });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const sid = parseCookies(req).sid;
    if (sid) sessions.delete(sid);
    return json(res, 200, { ok: true }, {
      "set-cookie": "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    });
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    return json(res, 200, { user: cleanSessionUser(user) });
  }

  return false;
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (url.pathname === "/api/health") return json(res, 200, { ok: true, service: "iot-sterile-room-monitor-saas" });

  const authResult = await handleAuth(req, res, url);
  if (authResult !== false) return authResult;

  if (url.pathname === "/api/readings" && req.method === "POST") {
    const payload = await readJson(req);
    const temperature = Number(payload.temperature ?? payload.temp);
    const humidity = Number(payload.humidity ?? payload.rh);
    const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity) || !Number.isFinite(timestamp.getTime())) {
      return json(res, 400, { error: "Required: temperature, humidity, optional timestamp" });
    }

    return withDb(db => {
      const key = String(payload.deviceKey || "");
      const payloadDeviceId = String(payload.deviceId || payload.device || "");
      const device = db.devices.find(item => item.deviceKey === key)
        || db.devices.find(item => item.deviceId === payloadDeviceId);
      if (!device) return json(res, 403, { error: "Unknown device. Register device key first." });

      const room = db.rooms.find(item => item.id === device.roomId);
      const reading = {
        id: id("read"),
        hospitalId: device.hospitalId,
        roomId: device.roomId,
        deviceId: device.id,
        deviceName: device.name,
        temperature: Number(temperature.toFixed(2)),
        humidity: Number(humidity.toFixed(2)),
        timestamp: timestamp.toISOString(),
        createdAt: nowIso()
      };
      db.readings.push(reading);
      device.lastSeenAt = reading.timestamp;

      const level = room ? alertLevel(reading, room) : "normal";
      if (level !== "normal" && room) {
        db.alerts.push({
          id: id("alert"),
          hospitalId: device.hospitalId,
          roomId: device.roomId,
          deviceId: device.id,
          readingId: reading.id,
          level,
          message: makeAlertMessage(reading, room, device),
          acknowledgedAt: null,
          createdAt: nowIso()
        });
      }
      return json(res, 201, { ok: true, reading, alertLevel: level });
    });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (url.pathname === "/api/bootstrap" && req.method === "GET") {
    const db = await loadDb();
    const hospitalIds = user.role === "system_admin"
      ? db.hospitals.map(item => item.id)
      : [user.hospitalId];
    return json(res, 200, {
      user: cleanSessionUser(user),
      hospitals: db.hospitals.filter(item => hospitalIds.includes(item.id)),
      rooms: db.rooms.filter(item => hospitalIds.includes(item.hospitalId)),
      devices: db.devices.filter(item => hospitalIds.includes(item.hospitalId)).map(item => ({ ...item, deviceKey: item.deviceKey })),
      alerts: db.alerts.filter(item => hospitalIds.includes(item.hospitalId) && !item.acknowledgedAt).slice(-50).reverse()
    });
  }

  if (url.pathname === "/api/hospitals" && req.method === "POST") {
    if (user.role !== "system_admin") return json(res, 403, { error: "System admin only" });
    const payload = await readJson(req);
    return withDb(db => {
      const hospital = {
        id: id("hosp"),
        name: String(payload.name || "").trim(),
        code: String(payload.code || "").trim() || `HOSP-${db.hospitals.length + 1}`,
        createdAt: nowIso()
      };
      if (!hospital.name) return json(res, 400, { error: "Hospital name is required" });
      db.hospitals.push(hospital);
      return json(res, 201, { hospital });
    });
  }

  if (url.pathname === "/api/rooms" && req.method === "POST") {
    const payload = await readJson(req);
    if (!sameTenant(user, payload.hospitalId)) return json(res, 403, { error: "Forbidden" });
    return withDb(db => {
      const room = {
        id: id("room"),
        hospitalId: String(payload.hospitalId),
        name: String(payload.name || "").trim(),
        tempMin: Number(payload.tempMin || 20),
        tempMax: Number(payload.tempMax || 24),
        rhMin: Number(payload.rhMin || 30),
        rhMax: Number(payload.rhMax || 60),
        createdAt: nowIso()
      };
      if (!room.name) return json(res, 400, { error: "Room name is required" });
      db.rooms.push(room);
      return json(res, 201, { room });
    });
  }

  if (url.pathname === "/api/devices" && req.method === "POST") {
    const payload = await readJson(req);
    if (!sameTenant(user, payload.hospitalId)) return json(res, 403, { error: "Forbidden" });
    return withDb(db => {
      const room = db.rooms.find(item => item.id === payload.roomId && item.hospitalId === payload.hospitalId);
      if (!room) return json(res, 400, { error: "Room not found" });
      const device = {
        id: id("dev"),
        hospitalId: String(payload.hospitalId),
        roomId: String(payload.roomId),
        name: String(payload.name || "").trim(),
        deviceId: String(payload.deviceId || payload.name || "").trim(),
        deviceKey: deviceKey(),
        lastSeenAt: null,
        createdAt: nowIso()
      };
      if (!device.name) return json(res, 400, { error: "Device name is required" });
      db.devices.push(device);
      return json(res, 201, { device });
    });
  }

  if (url.pathname === "/api/readings" && req.method === "GET") {
    const month = url.searchParams.get("month") || monthKey(new Date());
    const hospitalId = url.searchParams.get("hospitalId");
    const roomId = url.searchParams.get("roomId");
    if (hospitalId && !sameTenant(user, hospitalId)) return json(res, 403, { error: "Forbidden" });
    const db = await loadDb();
    const hospitalIds = user.role === "system_admin" ? db.hospitals.map(item => item.id) : [user.hospitalId];
    const readings = db.readings.filter(item => {
      const dt = new Date(item.timestamp);
      return Number.isFinite(dt.getTime())
        && monthKey(dt) === month
        && hospitalIds.includes(item.hospitalId)
        && (!hospitalId || item.hospitalId === hospitalId)
        && (!roomId || item.roomId === roomId);
    });
    return json(res, 200, { month, readings });
  }

  if (url.pathname === "/api/alerts" && req.method === "GET") {
    const db = await loadDb();
    const hospitalIds = user.role === "system_admin" ? db.hospitals.map(item => item.id) : [user.hospitalId];
    return json(res, 200, {
      alerts: db.alerts.filter(item => hospitalIds.includes(item.hospitalId)).slice(-200).reverse()
    });
  }

  if (url.pathname === "/api/alerts/ack" && req.method === "POST") {
    const payload = await readJson(req);
    return withDb(db => {
      const alert = db.alerts.find(item => item.id === payload.id);
      if (!alert) return json(res, 404, { error: "Alert not found" });
      if (!sameTenant(user, alert.hospitalId)) return json(res, 403, { error: "Forbidden" });
      alert.acknowledgedAt = nowIso();
      return json(res, 200, { alert });
    });
  }

  if (url.pathname === "/api/reports/monthly.csv" && req.method === "GET") {
    const month = url.searchParams.get("month") || monthKey(new Date());
    const hospitalId = url.searchParams.get("hospitalId");
    const roomId = url.searchParams.get("roomId");
    if (hospitalId && !sameTenant(user, hospitalId)) return json(res, 403, { error: "Forbidden" });
    const db = await loadDb();
    const rows = db.readings.filter(item => {
      const dt = new Date(item.timestamp);
      return monthKey(dt) === month && (!hospitalId || item.hospitalId === hospitalId) && (!roomId || item.roomId === roomId);
    });
    const csv = [
      "timestamp,hospital,room,device,temperature,humidity",
      ...rows.map(item => {
        const hospital = db.hospitals.find(h => h.id === item.hospitalId)?.name || "";
        const room = db.rooms.find(r => r.id === item.roomId)?.name || "";
        return [item.timestamp, hospital, room, item.deviceName, item.temperature, item.humidity]
          .map(value => `"${String(value).replaceAll('"', '""')}"`).join(",");
      })
    ].join("\n");
    return text(res, 200, csv, "text/csv; charset=utf-8");
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
    res.end(await fs.readFile(filePath));
  } catch {
    text(res, 404, "Not found");
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
    console.error(error);
    json(res, 500, { error: error.message || "Server error" });
  }
});

loadDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Sterile room SaaS monitor running at http://localhost:${PORT}`);
      console.log(`Default admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
