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
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const ALERT_WEBHOOK_TOKEN = process.env.ALERT_WEBHOOK_TOKEN || "";
const ALERT_COOLDOWN_MINUTES = Number(process.env.ALERT_COOLDOWN_MINUTES || 30);
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || "";

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
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
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
    const db = JSON.parse(raw);
    db.lineWebhookEvents = Array.isArray(db.lineWebhookEvents) ? db.lineWebhookEvents : [];
    for (const alert of db.alerts || []) {
      const reading = (db.readings || []).find(item => item.id === alert.readingId);
      const room = (db.rooms || []).find(item => item.id === alert.roomId);
      if (reading && room) alert.level = alertLevel(reading, room);
    }
    return db;
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
          alertWebhookUrl: "",
          alertWebhookToken: "",
          lineChannelAccessToken: "",
          lineTo: "",
          alertCooldownMinutes: 30,
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
      lineWebhookEvents: [],
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
    console.log(`Default admin email: ${ADMIN_EMAIL}`);
    console.log(`Demo device key: ${key}`);
    return db;
  }
}

async function saveDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

async function backupDb(db, reason) {
  const backupDir = path.join(DATA_DIR, "backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeReason = String(reason || "change").replace(/[^a-zA-Z0-9_-]/g, "_");
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(backupDir, `${timestamp}-${safeReason}.json`), JSON.stringify(db, null, 2), "utf8");
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

function datePartsInBangkok(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function localDateKey(date) {
  const parts = datePartsInBangkok(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localMonthKey(date) {
  const parts = datePartsInBangkok(date);
  return `${parts.year}-${parts.month}`;
}

function sameTenant(user, hospitalId) {
  return user.role === "system_admin" || user.hospitalId === hospitalId;
}

function canManageTenant(user, hospitalId) {
  return user.role === "system_admin" || (user.role === "hospital_admin" && user.hospitalId === hospitalId);
}

function visibleHospitalIds(user, db) {
  return user.role === "system_admin"
    ? db.hospitals.map(item => item.id)
    : [user.hospitalId].filter(Boolean);
}

function cleanUser(user) {
  return {
    id: user.id,
    hospitalId: user.hospitalId,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function cleanHospitalForUser(hospital, user) {
  const clean = { ...hospital };
  if (!canManageTenant(user, hospital.id)) {
    delete clean.alertWebhookUrl;
    delete clean.alertWebhookToken;
    delete clean.lineChannelAccessToken;
    delete clean.lineTo;
    delete clean.alertCooldownMinutes;
  }
  return clean;
}

function cleanLineWebhookEvent(event) {
  return {
    id: event.id,
    hospitalId: event.hospitalId || "",
    sourceType: event.sourceType,
    lineId: event.lineId,
    userId: event.userId || "",
    groupId: event.groupId || "",
    roomId: event.roomId || "",
    receivedAt: event.receivedAt
  };
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
  if (reading.temperature > 28 || reading.humidity > 70) return "critical";
  if (reading.temperature < room.tempMin || reading.humidity < room.rhMin) return "low";
  if (reading.temperature > 26 || reading.humidity > 65) return "high";
  if (reading.temperature > room.tempMax || reading.humidity > room.rhMax) return "caution";
  return "normal";
}

function tempLevel(reading, room) {
  if (reading.temperature < room.tempMin) return "low";
  if (reading.temperature > 28) return "critical";
  if (reading.temperature > 26) return "high";
  if (reading.temperature > room.tempMax) return "caution";
  return "normal";
}

function rhLevel(reading, room) {
  if (reading.humidity < room.rhMin) return "low";
  if (reading.humidity > 70) return "critical";
  if (reading.humidity > 65) return "high";
  if (reading.humidity > room.rhMax) return "caution";
  return "normal";
}

function levelStyle(level) {
  return {
    normal: { label: "ปกติ", color: "#03a624", textColor: "#ffffff" },
    caution: { label: "เฝ้าระวัง", color: "#ffe900", textColor: "#111827" },
    high: { label: "เสี่ยงสูง", color: "#ff7600", textColor: "#111827" },
    critical: { label: "วิกฤต", color: "#f40c0c", textColor: "#ffffff" },
    low: { label: "ต่ำกว่าเกณฑ์", color: "#082f86", textColor: "#ffffff" }
  }[level] || { label: level, color: "#526174", textColor: "#ffffff" };
}

function makeAlertMessage(reading, room, device) {
  const parts = [];
  if (reading.temperature < room.tempMin) parts.push(`Temp ต่ำ ${reading.temperature}°C`);
  if (reading.temperature > room.tempMax) parts.push(`Temp สูง ${reading.temperature}°C`);
  if (reading.humidity < room.rhMin) parts.push(`RH ต่ำ ${reading.humidity}%`);
  if (reading.humidity > room.rhMax) parts.push(`RH สูง ${reading.humidity}%`);
  return `${device.name}: ${parts.join(", ")}`;
}

function hospitalNotificationConfig(hospital) {
  return {
    url: hospital?.alertWebhookUrl || ALERT_WEBHOOK_URL,
    token: hospital?.alertWebhookToken || ALERT_WEBHOOK_TOKEN,
    lineChannelAccessToken: hospital?.lineChannelAccessToken || "",
    lineTo: hospital?.lineTo || "",
    cooldownMinutes: Number(hospital?.alertCooldownMinutes ?? ALERT_COOLDOWN_MINUTES)
  };
}

function shouldSendNotification(db, alert, config) {
  if (!config.url && !(config.lineChannelAccessToken && config.lineTo)) return false;
  if (!Number.isFinite(config.cooldownMinutes) || config.cooldownMinutes <= 0) return true;
  const cutoff = Date.now() - config.cooldownMinutes * 60 * 1000;
  return !db.alerts.some(item =>
    item.id !== alert.id
    && item.deviceId === alert.deviceId
    && item.level === alert.level
    && item.notificationSentAt
    && new Date(item.notificationSentAt).getTime() >= cutoff
  );
}

async function sendAlertNotification({ alert, reading, hospital, room, device, config = hospitalNotificationConfig(hospital) }) {
  const payload = {
    event: "sterile_room_alert",
    level: alert.level,
    message: alert.message,
    hospital: hospital?.name || "",
    room: room?.name || "",
    device: device?.name || "",
    deviceId: device?.deviceId || "",
    temperature: reading.temperature,
    humidity: reading.humidity,
    tempLevel: room ? tempLevel(reading, room) : "normal",
    rhLevel: room ? rhLevel(reading, room) : "normal",
    timestamp: reading.timestamp,
    appUrl: APP_PUBLIC_URL
  };

  if (config.lineChannelAccessToken && config.lineTo) {
    return sendLineNotification(payload, config);
  }

  if (!config.url) return { skipped: true };
  const headers = { "content-type": "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  const response = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status}`);
  }
  return { ok: true };
}

async function sendLineNotification(payload, config) {
  const alertStyle = levelStyle(payload.level);
  const tempStyle = levelStyle(payload.tempLevel);
  const rhStyle = levelStyle(payload.rhLevel);
  const text = [
    `แจ้งเตือน ${alertStyle.label}`,
    payload.hospital ? `รพ.: ${payload.hospital}` : "",
    payload.room ? `ห้อง: ${payload.room}` : "",
    payload.device ? `อุปกรณ์: ${payload.device}` : "",
    `Temp: ${payload.temperature} °C`,
    `RH: ${payload.humidity} %`,
    payload.message,
    payload.appUrl ? `ดูระบบ: ${payload.appUrl}` : ""
  ].filter(Boolean).join("\n");

  const metricRow = (label, value, unit, style) => ({
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#344054", flex: 2 },
      { type: "text", text: `${value} ${unit}`, size: "sm", weight: "bold", color: "#111827", flex: 2 },
      {
        type: "box",
        layout: "vertical",
        backgroundColor: style.color,
        cornerRadius: "md",
        paddingAll: "4px",
        flex: 2,
        contents: [{ type: "text", text: style.label, size: "xs", weight: "bold", align: "center", color: style.textColor }]
      }
    ]
  });

  const message = {
    type: "flex",
    altText: text,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: alertStyle.color,
        paddingAll: "14px",
        contents: [
          { type: "text", text: `แจ้งเตือน ${alertStyle.label}`, weight: "bold", size: "lg", color: alertStyle.textColor },
          { type: "text", text: payload.hospital || "Sterile Room Monitor", size: "xs", color: alertStyle.textColor, margin: "sm", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: payload.room || "-", weight: "bold", size: "md", color: "#003b7a", wrap: true },
          { type: "text", text: payload.device || "-", size: "sm", color: "#475467", wrap: true },
          { type: "separator", margin: "sm" },
          metricRow("Temp", payload.temperature, "°C", tempStyle),
          metricRow("RH", payload.humidity, "%", rhStyle),
          { type: "text", text: payload.message, size: "xs", color: "#475467", wrap: true, margin: "sm" }
        ]
      }
    }
  };

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.lineChannelAccessToken}`
    },
    body: JSON.stringify({
      to: config.lineTo,
      messages: [message]
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE push failed: ${response.status} ${body}`.trim());
  }
  return { ok: true, channel: "line" };
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

  if (url.pathname === "/api/line/webhook" && req.method === "POST") {
    const payload = await readJson(req);
    const hospitalId = String(url.searchParams.get("hospitalId") || "");
    const events = Array.isArray(payload.events) ? payload.events : [];
    const rows = events
      .map(event => {
        const source = event.source || {};
        const lineId = source.groupId || source.roomId || source.userId || "";
        if (!lineId) return null;
        return {
          id: id("line"),
          hospitalId,
          sourceType: source.type || "",
          lineId,
          userId: source.userId || "",
          groupId: source.groupId || "",
          roomId: source.roomId || "",
          receivedAt: nowIso()
        };
      })
      .filter(Boolean);
    if (rows.length) {
      await withDb(db => {
        db.lineWebhookEvents = [...(db.lineWebhookEvents || []), ...rows].slice(-100);
        return { ok: true };
      });
    }
    return json(res, 200, { ok: true, saved: rows.length });
  }

  if (url.pathname === "/api/readings" && req.method === "POST") {
    const payload = await readJson(req);
    const temperature = Number(payload.temperature ?? payload.temp);
    const humidity = Number(payload.humidity ?? payload.rh);
    const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity) || !Number.isFinite(timestamp.getTime())) {
      return json(res, 400, { error: "Required: temperature, humidity, optional timestamp" });
    }

    return withDb(async db => {
      const key = String(payload.deviceKey || "");
      const payloadDeviceId = String(payload.deviceId || payload.device || "");
      const device = db.devices.find(item => item.deviceKey === key)
        || db.devices.find(item => item.deviceId === payloadDeviceId);
      if (!device) return json(res, 403, { error: "Unknown device. Register device key first." });

      const room = db.rooms.find(item => item.id === device.roomId);
      const hospital = db.hospitals.find(item => item.id === device.hospitalId);
      const notificationConfig = hospitalNotificationConfig(hospital);
      const reading = {
        id: id("read"),
        hospitalId: device.hospitalId,
        roomId: device.roomId,
        deviceId: device.id,
        deviceName: device.name,
        temperature: Number(temperature.toFixed(2)),
        humidity: Number(humidity.toFixed(2)),
        timestamp: timestamp.toISOString(),
        localDate: localDateKey(timestamp),
        localMonth: localMonthKey(timestamp),
        createdAt: nowIso()
      };
      db.readings.push(reading);
      device.lastSeenAt = reading.timestamp;

      const level = room ? alertLevel(reading, room) : "normal";
      if (level !== "normal" && room) {
        const alert = {
          id: id("alert"),
          hospitalId: device.hospitalId,
          roomId: device.roomId,
          deviceId: device.id,
          readingId: reading.id,
          level,
          message: makeAlertMessage(reading, room, device),
          acknowledgedAt: null,
          notificationSentAt: null,
          notificationError: null,
          createdAt: nowIso()
        };
        db.alerts.push(alert);
        if (shouldSendNotification(db, alert, notificationConfig)) {
          try {
            await sendAlertNotification({ alert, reading, hospital, room, device, config: notificationConfig });
            alert.notificationSentAt = nowIso();
          } catch (error) {
            alert.notificationError = error.message || "Notification failed";
            console.error(alert.notificationError);
          }
        }
      }
      return json(res, 201, { ok: true, reading, alertLevel: level });
    });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (url.pathname === "/api/bootstrap" && req.method === "GET") {
    const db = await loadDb();
    const hospitalIds = visibleHospitalIds(user, db);
    const managementStats = {
      hospitals: Object.fromEntries(hospitalIds.map(hospitalId => [hospitalId, {
        rooms: db.rooms.filter(item => item.hospitalId === hospitalId).length,
        devices: db.devices.filter(item => item.hospitalId === hospitalId).length,
        readings: db.readings.filter(item => item.hospitalId === hospitalId).length,
        alerts: db.alerts.filter(item => item.hospitalId === hospitalId).length,
        users: db.users.filter(item => item.hospitalId === hospitalId).length
      }])),
      rooms: Object.fromEntries(db.rooms
        .filter(item => hospitalIds.includes(item.hospitalId))
        .map(room => [room.id, {
          devices: db.devices.filter(item => item.roomId === room.id).length,
          readings: db.readings.filter(item => item.roomId === room.id).length,
          alerts: db.alerts.filter(item => item.roomId === room.id).length
        }]))
    };
    return json(res, 200, {
      user: cleanSessionUser(user),
      hospitals: db.hospitals.filter(item => hospitalIds.includes(item.id)).map(item => cleanHospitalForUser(item, user)),
      rooms: db.rooms.filter(item => hospitalIds.includes(item.hospitalId)),
      devices: db.devices.filter(item => hospitalIds.includes(item.hospitalId)).map(item => ({ ...item, deviceKey: item.deviceKey })),
      alerts: db.alerts.filter(item => hospitalIds.includes(item.hospitalId) && !item.acknowledgedAt).slice(-50).reverse(),
      users: db.users.filter(item => item.role !== "system_admin" && hospitalIds.includes(item.hospitalId)).map(cleanUser),
      managementStats,
      lineWebhookEvents: canManageTenant(user, hospitalIds[0])
        ? (db.lineWebhookEvents || []).filter(item => !item.hospitalId || hospitalIds.includes(item.hospitalId)).slice(-20).reverse().map(cleanLineWebhookEvent)
        : []
    });
  }

  if (url.pathname === "/api/hospitals" && req.method === "POST") {
    if (user.role !== "system_admin") return json(res, 403, { error: "System admin only" });
    const payload = await readJson(req);
    return withDb(async db => {
      const hospital = {
        id: id("hosp"),
        name: String(payload.name || "").trim(),
        code: String(payload.code || "").trim() || `HOSP-${db.hospitals.length + 1}`,
        alertWebhookUrl: "",
        alertWebhookToken: "",
        lineChannelAccessToken: "",
        lineTo: "",
        alertCooldownMinutes: 30,
        createdAt: nowIso()
      };
      if (!hospital.name) return json(res, 400, { error: "Hospital name is required" });
      db.hospitals.push(hospital);
      return json(res, 201, { hospital });
    });
  }

  if (url.pathname.startsWith("/api/hospitals/") && req.method === "PUT") {
    if (user.role !== "system_admin") return json(res, 403, { error: "System admin only" });
    const hospitalId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const payload = await readJson(req);
    return withDb(async db => {
      const hospital = db.hospitals.find(item => item.id === hospitalId);
      if (!hospital) return json(res, 404, { error: "Hospital not found" });
      const name = String(payload.name || "").trim();
      if (!name) return json(res, 400, { error: "Hospital name is required" });
      hospital.name = name;
      hospital.code = String(payload.code || "").trim() || hospital.code;
      return json(res, 200, { hospital });
    });
  }

  if (url.pathname.startsWith("/api/hospitals/") && req.method === "DELETE") {
    if (user.role !== "system_admin") return json(res, 403, { error: "System admin only" });
    const hospitalId = decodeURIComponent(url.pathname.split("/").pop() || "");
    return withDb(async db => {
      const hospital = db.hospitals.find(item => item.id === hospitalId);
      if (!hospital) return json(res, 404, { error: "Hospital not found" });
      const related = {
        rooms: db.rooms.filter(item => item.hospitalId === hospitalId).length,
        devices: db.devices.filter(item => item.hospitalId === hospitalId).length,
        readings: db.readings.filter(item => item.hospitalId === hospitalId).length,
        alerts: db.alerts.filter(item => item.hospitalId === hospitalId).length,
        users: db.users.filter(item => item.hospitalId === hospitalId).length
      };
      const totalRelated = Object.values(related).reduce((sum, count) => sum + count, 0);
      if (totalRelated > 0) {
        return json(res, 409, {
          error: "ไม่สามารถลบโรงพยาบาลที่ยังมีห้อง อุปกรณ์ ข้อมูลรายวัน แจ้งเตือน หรือผู้ใช้",
          related
        });
      }
      await backupDb(db, `delete-hospital-${hospitalId}`);
      db.hospitals = db.hospitals.filter(item => item.id !== hospitalId);
      return json(res, 200, { ok: true });
    });
  }

  if (url.pathname === "/api/hospitals/alert-settings" && req.method === "POST") {
    const payload = await readJson(req);
    const hospitalId = String(payload.hospitalId || "");
    if (!canManageTenant(user, hospitalId)) return json(res, 403, { error: "Forbidden" });
    return withDb(db => {
      const hospital = db.hospitals.find(item => item.id === hospitalId);
      if (!hospital) return json(res, 404, { error: "Hospital not found" });
      hospital.alertWebhookUrl = String(payload.alertWebhookUrl || "").trim();
      hospital.alertWebhookToken = String(payload.alertWebhookToken || "").trim();
      hospital.lineChannelAccessToken = String(payload.lineChannelAccessToken || "").trim();
      hospital.lineTo = String(payload.lineTo || "").trim();
      const cooldown = Number(payload.alertCooldownMinutes);
      hospital.alertCooldownMinutes = Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : 30;
      return json(res, 200, { hospital });
    });
  }

  if (url.pathname === "/api/rooms" && req.method === "POST") {
    const payload = await readJson(req);
    if (!canManageTenant(user, payload.hospitalId)) return json(res, 403, { error: "Forbidden" });
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

  if (url.pathname.startsWith("/api/rooms/") && req.method === "PUT") {
    const roomId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const payload = await readJson(req);
    return withDb(async db => {
      const room = db.rooms.find(item => item.id === roomId);
      if (!room) return json(res, 404, { error: "Room not found" });
      if (!canManageTenant(user, room.hospitalId)) return json(res, 403, { error: "Forbidden" });
      const name = String(payload.name || "").trim();
      if (!name) return json(res, 400, { error: "Room name is required" });
      room.name = name;
      const tempMin = Number(payload.tempMin);
      const tempMax = Number(payload.tempMax);
      const rhMin = Number(payload.rhMin);
      const rhMax = Number(payload.rhMax);
      if (![tempMin, tempMax, rhMin, rhMax].every(Number.isFinite)) return json(res, 400, { error: "Room limits must be numbers" });
      room.tempMin = tempMin;
      room.tempMax = tempMax;
      room.rhMin = rhMin;
      room.rhMax = rhMax;
      return json(res, 200, { room });
    });
  }

  if (url.pathname.startsWith("/api/rooms/") && req.method === "DELETE") {
    const roomId = decodeURIComponent(url.pathname.split("/").pop() || "");
    return withDb(async db => {
      const room = db.rooms.find(item => item.id === roomId);
      if (!room) return json(res, 404, { error: "Room not found" });
      if (!canManageTenant(user, room.hospitalId)) return json(res, 403, { error: "Forbidden" });
      const related = {
        devices: db.devices.filter(item => item.roomId === roomId).length,
        readings: db.readings.filter(item => item.roomId === roomId).length,
        alerts: db.alerts.filter(item => item.roomId === roomId).length
      };
      const totalRelated = Object.values(related).reduce((sum, count) => sum + count, 0);
      if (totalRelated > 0) {
        return json(res, 409, {
          error: "ไม่สามารถลบห้องที่ยังมีอุปกรณ์ ข้อมูลรายวัน หรือแจ้งเตือน",
          related
        });
      }
      await backupDb(db, `delete-room-${roomId}`);
      db.rooms = db.rooms.filter(item => item.id !== roomId);
      return json(res, 200, { ok: true });
    });
  }

  if (url.pathname === "/api/devices" && req.method === "POST") {
    const payload = await readJson(req);
    if (!canManageTenant(user, payload.hospitalId)) return json(res, 403, { error: "Forbidden" });
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

  if (url.pathname.startsWith("/api/devices/") && req.method === "PUT") {
    const deviceId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const payload = await readJson(req);
    return withDb(db => {
      const device = db.devices.find(item => item.id === deviceId);
      if (!device) return json(res, 404, { error: "Device not found" });
      if (!canManageTenant(user, device.hospitalId)) return json(res, 403, { error: "Forbidden" });
      const room = db.rooms.find(item => item.id === String(payload.roomId || device.roomId) && item.hospitalId === device.hospitalId);
      if (!room) return json(res, 400, { error: "Room not found" });
      const name = String(payload.name || "").trim();
      if (!name) return json(res, 400, { error: "Device name is required" });
      device.name = name;
      device.deviceId = String(payload.deviceId || name).trim();
      device.roomId = room.id;
      return json(res, 200, { device });
    });
  }

  if (url.pathname.startsWith("/api/devices/") && req.method === "DELETE") {
    const deviceId = decodeURIComponent(url.pathname.split("/").pop() || "");
    return withDb(async db => {
      const device = db.devices.find(item => item.id === deviceId);
      if (!device) return json(res, 404, { error: "Device not found" });
      if (!canManageTenant(user, device.hospitalId)) return json(res, 403, { error: "Forbidden" });
      await backupDb(db, `delete-device-${deviceId}`);
      db.devices = db.devices.filter(item => item.id !== deviceId);
      return json(res, 200, { ok: true });
    });
  }

  if (url.pathname === "/api/users" && req.method === "POST") {
    const payload = await readJson(req);
    const hospitalId = String(payload.hospitalId || "");
    if (!canManageTenant(user, hospitalId)) return json(res, 403, { error: "Forbidden" });
    return withDb(db => {
      const hospital = db.hospitals.find(item => item.id === hospitalId);
      if (!hospital) return json(res, 400, { error: "Hospital not found" });
      const role = String(payload.role || "staff");
      const allowedRoles = user.role === "system_admin"
        ? ["hospital_admin", "staff", "auditor"]
        : ["staff", "auditor"];
      if (!allowedRoles.includes(role)) return json(res, 400, { error: "Role is not allowed" });
      const email = String(payload.email || "").trim().toLowerCase();
      if (!email || !String(payload.password || "").trim()) return json(res, 400, { error: "Email and password are required" });
      if (db.users.some(item => item.email.toLowerCase() === email)) return json(res, 409, { error: "Email already exists" });
      const newUser = {
        id: id("usr"),
        hospitalId,
        name: String(payload.name || "").trim() || email,
        email,
        passwordHash: hashPassword(String(payload.password)),
        role,
        createdAt: nowIso()
      };
      db.users.push(newUser);
      return json(res, 201, { user: cleanUser(newUser) });
    });
  }

  if (url.pathname.startsWith("/api/users/") && req.method === "PUT") {
    const targetUserId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const payload = await readJson(req);
    return withDb(db => {
      const target = db.users.find(item => item.id === targetUserId && item.role !== "system_admin");
      if (!target) return json(res, 404, { error: "User not found" });
      if (!canManageTenant(user, target.hospitalId)) return json(res, 403, { error: "Forbidden" });
      const allowedRoles = user.role === "system_admin" ? ["hospital_admin", "staff", "auditor"] : ["staff", "auditor"];
      const role = String(payload.role || target.role);
      if (!allowedRoles.includes(role)) return json(res, 400, { error: "Role is not allowed" });
      const email = String(payload.email || "").trim().toLowerCase();
      if (!email) return json(res, 400, { error: "Email is required" });
      if (db.users.some(item => item.id !== targetUserId && item.email.toLowerCase() === email)) return json(res, 409, { error: "Email already exists" });
      target.name = String(payload.name || "").trim() || email;
      target.email = email;
      target.role = role;
      if (String(payload.password || "").trim()) target.passwordHash = hashPassword(String(payload.password));
      return json(res, 200, { user: cleanUser(target) });
    });
  }

  if (url.pathname.startsWith("/api/users/") && req.method === "DELETE") {
    const targetUserId = decodeURIComponent(url.pathname.split("/").pop() || "");
    return withDb(async db => {
      const target = db.users.find(item => item.id === targetUserId && item.role !== "system_admin");
      if (!target) return json(res, 404, { error: "User not found" });
      if (!canManageTenant(user, target.hospitalId)) return json(res, 403, { error: "Forbidden" });
      await backupDb(db, `delete-user-${targetUserId}`);
      db.users = db.users.filter(item => item.id !== targetUserId);
      return json(res, 200, { ok: true });
    });
  }

  if (url.pathname === "/api/users" && req.method === "GET") {
    const db = await loadDb();
    const hospitalIds = visibleHospitalIds(user, db);
    return json(res, 200, {
      users: db.users.filter(item => item.role !== "system_admin" && hospitalIds.includes(item.hospitalId)).map(cleanUser)
    });
  }

  if (url.pathname === "/api/readings" && req.method === "GET") {
    const month = url.searchParams.get("month") || localMonthKey(new Date());
    const hospitalId = url.searchParams.get("hospitalId");
    const roomId = url.searchParams.get("roomId");
    if (hospitalId && !sameTenant(user, hospitalId)) return json(res, 403, { error: "Forbidden" });
    const db = await loadDb();
    const hospitalIds = visibleHospitalIds(user, db);
    const readings = db.readings.filter(item => {
      const dt = new Date(item.timestamp);
      const readingMonth = item.localMonth || (Number.isFinite(dt.getTime()) ? localMonthKey(dt) : "");
      return Number.isFinite(dt.getTime())
        && readingMonth === month
        && hospitalIds.includes(item.hospitalId)
        && (!hospitalId || item.hospitalId === hospitalId)
        && (!roomId || item.roomId === roomId);
    });
    return json(res, 200, { month, readings });
  }

  if (url.pathname === "/api/alerts" && req.method === "GET") {
    const db = await loadDb();
    const hospitalIds = visibleHospitalIds(user, db);
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

  if (url.pathname === "/api/notifications/test" && req.method === "POST") {
    if (!["system_admin", "hospital_admin"].includes(user.role)) return json(res, 403, { error: "Forbidden" });
    const db = await loadDb();
    const hospital = user.role === "system_admin"
      ? db.hospitals.find(item => item.id === url.searchParams.get("hospitalId")) || db.hospitals[0]
      : db.hospitals.find(item => item.id === user.hospitalId);
    if (!canManageTenant(user, hospital?.id)) return json(res, 403, { error: "Forbidden" });
    const notificationConfig = hospitalNotificationConfig(hospital);
    if (!notificationConfig.url && !(notificationConfig.lineChannelAccessToken && notificationConfig.lineTo)) {
      return json(res, 400, { error: "Notification is not configured for this hospital" });
    }
    const room = db.rooms.find(item => item.hospitalId === hospital?.id);
    const device = db.devices.find(item => item.roomId === room?.id);
    const reading = {
      temperature: 29.1,
      humidity: 72.4,
      timestamp: nowIso()
    };
    const alert = {
      id: id("alert_test"),
      level: "critical",
      message: "ทดสอบแจ้งเตือน Temp/RH ผิดเกณฑ์"
    };
    await sendAlertNotification({ alert, reading, hospital, room, device, config: notificationConfig });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/reports/monthly.csv" && req.method === "GET") {
    const month = url.searchParams.get("month") || localMonthKey(new Date());
    const hospitalId = url.searchParams.get("hospitalId");
    const roomId = url.searchParams.get("roomId");
    if (hospitalId && !sameTenant(user, hospitalId)) return json(res, 403, { error: "Forbidden" });
    const db = await loadDb();
    const hospitalIds = visibleHospitalIds(user, db);
    const rows = db.readings.filter(item => {
      const dt = new Date(item.timestamp);
      const readingMonth = item.localMonth || (Number.isFinite(dt.getTime()) ? localMonthKey(dt) : "");
      return readingMonth === month
        && hospitalIds.includes(item.hospitalId)
        && (!hospitalId || item.hospitalId === hospitalId)
        && (!roomId || item.roomId === roomId);
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
      console.log(`Admin email: ${ADMIN_EMAIL}`);
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
