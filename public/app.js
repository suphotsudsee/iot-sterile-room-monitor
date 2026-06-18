const state = {
  user: null,
  hospitals: [],
  rooms: [],
  devices: [],
  alerts: [],
  readings: []
};

const tempRows = [
  { key: "critical", label: "> 28 °C", className: "critical", color: "#f40c0c" },
  { key: "high", label: "26.1 - 28 °C", className: "high", color: "#ff7600" },
  { key: "caution", label: "24.1 - 26 °C", className: "caution", color: "#ffe900" },
  { key: "normal", label: "20 - 24 °C", className: "normal", color: "#03a624" },
  { key: "low", label: "< 20 °C", className: "low", color: "#082f86" }
];

const rhRows = [
  { key: "critical", label: "> 70 %", className: "critical", color: "#f40c0c" },
  { key: "high", label: "66 - 70 %", className: "high", color: "#ff7600" },
  { key: "caution", label: "61 - 65 %", className: "caution", color: "#ffe900" },
  { key: "normal", label: "30 - 60 %", className: "normal", color: "#03a624" },
  { key: "low", label: "< 30 %", className: "low", color: "#082f86" }
];

const $ = selector => document.querySelector(selector);

function pad(value) {
  return String(value).padStart(2, "0");
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function daysInMonth(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m, 0).getDate();
}

function toThaiYear(month) {
  return String(Number(month.split("-")[0]) + 543);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function format(value, decimals = 1) {
  return Number.isFinite(value) ? value.toFixed(decimals) : "-";
}

function selectedHospitalId() {
  return $("#hospitalSelect").value;
}

function selectedRoomId() {
  return $("#roomSelect").value;
}

function selectedRoom() {
  return state.rooms.find(room => room.id === selectedRoomId());
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error || body || "Request failed");
  return body;
}

function showApp(show) {
  $("#loginView").classList.toggle("hidden", show);
  $("#appView").classList.toggle("hidden", !show);
}

function tempLevel(value) {
  const room = selectedRoom();
  const min = room?.tempMin ?? 20;
  const max = room?.tempMax ?? 24;
  if (!Number.isFinite(value)) return null;
  if (value > 28 || value < min) return "critical";
  if (value > 26) return "high";
  if (value > max) return "caution";
  return "normal";
}

function rhLevel(value) {
  const room = selectedRoom();
  const min = room?.rhMin ?? 30;
  const max = room?.rhMax ?? 60;
  if (!Number.isFinite(value)) return null;
  if (value > 70 || value < min) return "critical";
  if (value > 65) return "high";
  if (value > max) return "caution";
  return "normal";
}

function overallLevel(day) {
  const levels = [tempLevel(day.temperature), rhLevel(day.humidity)];
  if (levels.includes("critical")) return "critical";
  if (levels.includes("high")) return "high";
  if (levels.includes("caution")) return "caution";
  return "normal";
}

function groupDaily(readings, month) {
  const days = daysInMonth(month);
  const result = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    temperature: null,
    humidity: null,
    count: 0,
    deviceName: ""
  }));

  readings.forEach(reading => {
    const dt = new Date(reading.timestamp);
    const slot = result[dt.getDate() - 1];
    if (!slot) return;
    slot.tempValues = slot.tempValues || [];
    slot.rhValues = slot.rhValues || [];
    slot.tempValues.push(Number(reading.temperature));
    slot.rhValues.push(Number(reading.humidity));
    slot.count += 1;
    slot.deviceName = reading.deviceName || slot.deviceName;
  });

  result.forEach(day => {
    day.temperature = mean(day.tempValues || []);
    day.humidity = mean(day.rhValues || []);
  });
  return result;
}

function makeCell(text, className = "") {
  const div = document.createElement("div");
  div.className = `cell ${className}`.trim();
  div.textContent = text;
  return div;
}

function drawGrid(target, rows, days, getValue, getLevel) {
  target.innerHTML = "";
  target.style.setProperty("--days", days.length);
  target.appendChild(makeCell("วันที่", "head"));
  days.forEach(day => target.appendChild(makeCell(day.day, "head")));

  rows.forEach(row => {
    const label = makeCell("", "label");
    const badge = document.createElement("span");
    badge.className = `badge ${row.className}`;
    badge.style.background = row.color;
    badge.textContent = row.label;
    label.appendChild(badge);
    target.appendChild(label);

    days.forEach(day => {
      const cell = makeCell("", `row-${row.key}`);
      const value = getValue(day);
      if (getLevel(value) === row.key) {
        const reading = document.createElement("span");
        reading.className = `reading ${row.className}`;
        reading.style.background = row.color;
        reading.textContent = format(value);
        cell.appendChild(reading);
      }
      target.appendChild(cell);
    });
  });
}

function setText(id, value) {
  $(id).textContent = value;
}

function drawSummary(days) {
  const available = days.filter(day => Number.isFinite(day.temperature) && Number.isFinite(day.humidity));
  const tempValues = available.map(day => day.temperature);
  const rhValues = available.map(day => day.humidity);
  setText("#maxTemp", tempValues.length ? format(Math.max(...tempValues)) : "-");
  setText("#minTemp", tempValues.length ? format(Math.min(...tempValues)) : "-");
  setText("#avgTemp", format(mean(tempValues)));
  setText("#maxRh", rhValues.length ? format(Math.max(...rhValues)) : "-");
  setText("#minRh", rhValues.length ? format(Math.min(...rhValues)) : "-");
  setText("#avgRh", format(mean(rhValues)));

  const counts = { normal: 0, caution: 0, high: 0, critical: 0 };
  available.forEach(day => {
    counts[overallLevel(day)] += 1;
  });

  const cards = [
    { key: "normal", title: "ปกติ (เขียว)", className: "normal" },
    { key: "caution", title: "เฝ้าระวัง (เหลือง)", className: "caution" },
    { key: "high", title: "เสี่ยงสูง (ส้ม)", className: "high" },
    { key: "critical", title: "วิกฤต (แดง)", className: "critical" }
  ];

  $("#summaryCards").innerHTML = cards.map(card => {
    const percent = available.length ? (counts[card.key] / available.length) * 100 : 0;
    return `<article class="summary-card ${card.className}">
      <b>${card.title}</b>
      <p>จำนวนวัน ${counts[card.key]} วัน</p>
      <p>คิดเป็น ${format(percent, 0)} %</p>
    </article>`;
  }).join("");
}

function renderSelectors() {
  $("#hospitalSelect").innerHTML = state.hospitals.map(item => `<option value="${item.id}">${item.name}</option>`).join("");
  const rooms = state.rooms.filter(item => item.hospitalId === selectedHospitalId());
  $("#roomSelect").innerHTML = rooms.map(item => `<option value="${item.id}">${item.name}</option>`).join("");
}

function renderDevices() {
  const devices = state.devices.filter(item => item.roomId === selectedRoomId());
  $("#deviceList").innerHTML = devices.length
    ? devices.map(device => `<div class="device-row">
        <b>${device.name}</b>
        <span>${device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString("th-TH") : "ยังไม่มีข้อมูล"}</span>
        <code>${device.deviceKey}</code>
      </div>`).join("")
    : "<p>ยังไม่มีอุปกรณ์ในห้องนี้</p>";
}

function renderAlerts() {
  const alerts = state.alerts.filter(item => item.roomId === selectedRoomId()).slice(0, 5);
  $("#alertList").innerHTML = alerts.length
    ? alerts.map(item => `<div class="alert ${item.level}">
        <b>${item.level}</b>
        <span>${item.message}</span>
      </div>`).join("")
    : "<p>ไม่มีแจ้งเตือนค้างอยู่</p>";
}

function renderStandards() {
  const room = selectedRoom();
  $("#roomTitle").textContent = room ? `${room.name} (Sterile Storage Room)` : "Sterile Storage Room";
  $("#tempStandard").textContent = room ? `${room.tempMin} - ${room.tempMax} °C` : "20 - 24 °C";
  $("#rhStandard").textContent = room ? `${room.rhMin} - ${room.rhMax} %` : "30 - 60 %";
}

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  $("#userLabel").textContent = `${state.user.name} (${state.user.role})`;
  renderSelectors();
}

async function loadDashboard() {
  const month = $("#monthPicker").value || currentMonth();
  $("#thaiYear").value = toThaiYear(month);
  renderStandards();
  renderDevices();
  renderAlerts();

  const query = new URLSearchParams({ month, hospitalId: selectedHospitalId(), roomId: selectedRoomId() });
  const payload = await api(`/api/readings?${query}`);
  state.readings = payload.readings || [];
  const days = groupDaily(state.readings, month);
  drawGrid($("#tempGrid"), tempRows, days, day => day.temperature, tempLevel);
  drawGrid($("#humidityGrid"), rhRows, days, day => day.humidity, rhLevel);
  drawSummary(days);

  const latest = [...state.readings].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  $("#deviceStatus").textContent = latest
    ? `${latest.deviceName} ส่งข้อมูลล่าสุด ${new Date(latest.timestamp).toLocaleString("th-TH")}`
    : "ยังไม่มีข้อมูลในเดือนนี้";

  $("#reportLink").href = `/api/reports/monthly.csv?${query}`;
  $("#serverUrlText").textContent = `${location.origin}/api/readings`;
}

async function refreshAll() {
  await loadBootstrap();
  await loadDashboard();
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#loginError").textContent = "";
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    showApp(true);
    await refreshAll();
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  showApp(false);
});

$("#hospitalSelect").addEventListener("change", () => {
  renderSelectors();
  loadDashboard();
});
$("#roomSelect").addEventListener("change", loadDashboard);
$("#monthPicker").addEventListener("change", loadDashboard);

$("#hospitalForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/hospitals", { method: "POST", body: JSON.stringify({ name: form.get("name"), code: form.get("code") }) });
  event.currentTarget.reset();
  await refreshAll();
});

$("#roomForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      hospitalId: selectedHospitalId(),
      name: form.get("name"),
      tempMin: Number(form.get("tempMin")),
      tempMax: Number(form.get("tempMax")),
      rhMin: Number(form.get("rhMin")),
      rhMax: Number(form.get("rhMax"))
    })
  });
  event.currentTarget.reset();
  await refreshAll();
});

$("#deviceForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api("/api/devices", {
    method: "POST",
    body: JSON.stringify({
      hospitalId: selectedHospitalId(),
      roomId: selectedRoomId(),
      name: form.get("name"),
      deviceId: form.get("deviceId")
    })
  });
  event.currentTarget.reset();
  await refreshAll();
});

$("#manualForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const device = state.devices.find(item => item.roomId === selectedRoomId());
  if (!device) {
    alert("กรุณาเพิ่มอุปกรณ์ก่อน");
    return;
  }
  await api("/api/readings", {
    method: "POST",
    body: JSON.stringify({
      deviceKey: device.deviceKey,
      temperature: Number(form.get("temperature")),
      humidity: Number(form.get("humidity"))
    })
  });
  event.currentTarget.reset();
  await refreshAll();
});

$("#monthPicker").value = currentMonth();

api("/api/me")
  .then(async data => {
    state.user = data.user;
    showApp(true);
    await refreshAll();
  })
  .catch(() => showApp(false));
