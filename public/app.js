const state = {
  user: null,
  hospitals: [],
  rooms: [],
  devices: [],
  alerts: [],
  users: [],
  readings: [],
  currentPage: "dashboard"
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

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

function selectedHospital() {
  return state.hospitals.find(hospital => hospital.id === selectedHospitalId());
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

function canManageCurrentUser() {
  return ["system_admin", "hospital_admin"].includes(state.user?.role);
}

function showPage(page) {
  const requestedPage = page === "management" && canManageCurrentUser() ? "management" : "dashboard";
  state.currentPage = requestedPage;
  $("#dashboardPage").classList.toggle("hidden", requestedPage !== "dashboard");
  $("#managementPage").classList.toggle("hidden", requestedPage !== "management");
  $("#dashboardTab").classList.toggle("active", requestedPage === "dashboard");
  $("#managementTab").classList.toggle("active", requestedPage === "management");
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

function levelRank(level) {
  return { normal: 0, caution: 1, high: 2, critical: 3 }[level] ?? -1;
}

function pickDailyDisplayValue(items, getValue, getLevel) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const latest = sorted[sorted.length - 1];
  const abnormal = sorted
    .map(item => ({ item, value: getValue(item), level: getLevel(getValue(item)) }))
    .filter(entry => Number.isFinite(entry.value) && entry.level && entry.level !== "normal")
    .sort((a, b) => {
      const levelDiff = levelRank(b.level) - levelRank(a.level);
      if (levelDiff) return levelDiff;
      return new Date(b.item.timestamp) - new Date(a.item.timestamp);
    })[0];
  return abnormal ? abnormal.value : getValue(latest);
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
    slot.readings = slot.readings || [];
    slot.readings.push(reading);
    slot.count += 1;
    slot.deviceName = reading.deviceName || slot.deviceName;
  });

  result.forEach(day => {
    const items = day.readings || [];
    day.temperature = pickDailyDisplayValue(items, item => Number(item.temperature), tempLevel);
    day.humidity = pickDailyDisplayValue(items, item => Number(item.humidity), rhLevel);
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

  const tempCounts = { normal: 0, caution: 0, high: 0, critical: 0 };
  const rhCounts = { normal: 0, caution: 0, high: 0, critical: 0 };
  available.forEach(day => {
    tempCounts[tempLevel(day.temperature)] += 1;
    rhCounts[rhLevel(day.humidity)] += 1;
  });

  const cards = [
    { key: "normal", title: "ปกติ (เขียว)", className: "normal" },
    { key: "caution", title: "เฝ้าระวัง (เหลือง)", className: "caution" },
    { key: "high", title: "เสี่ยงสูง (ส้ม)", className: "high" },
    { key: "critical", title: "วิกฤต (แดง)", className: "critical" }
  ];

  function renderMetricSummary(title, unit, counts) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const nodes = cards.map(card => {
      const percent = total ? (counts[card.key] / total) * 100 : 0;
      return `<article class="summary-card ${card.className}">
        <b>${card.title}</b>
        <p>จำนวนวัน ${counts[card.key]} วัน</p>
        <p>คิดเป็น ${format(percent, 0)} %</p>
      </article>`;
    }).join("");
    return `<div class="summary-group">
      <h4>${title} <span>${unit}</span></h4>
      <div class="summary-card-grid">${nodes}</div>
    </div>`;
  }

  $("#summaryCards").innerHTML =
    renderMetricSummary("อุณหภูมิ", "°C", tempCounts)
    + renderMetricSummary("ความชื้นสัมพัทธ์", "RH %", rhCounts);
}

function renderLatestReadings(readings) {
  const latest = [...readings]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 12);

  $("#latestReadingsList").innerHTML = latest.length
    ? `<div class="latest-row latest-head">
        <span>เวลา</span><span>Temp</span><span>RH</span>
      </div>` + latest.map(reading => `<div class="latest-row">
        <span>${new Date(reading.timestamp).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        <b>${format(Number(reading.temperature))} °C</b>
        <b>${format(Number(reading.humidity))} %</b>
      </div>`).join("")
    : "<p>ยังไม่มีค่าที่ส่งเข้ามา</p>";
}

function renderSelectors() {
  const currentHospitalId = $("#hospitalSelect").value || state.user?.hospitalId;
  const currentRoomId = $("#roomSelect").value;
  $("#hospitalSelect").innerHTML = state.hospitals.map(item => `<option value="${item.id}">${item.name}</option>`).join("");
  if (state.hospitals.some(item => item.id === currentHospitalId)) $("#hospitalSelect").value = currentHospitalId;
  $("#hospitalSelect").disabled = state.user?.role !== "system_admin";
  $("#hospitalForm").classList.toggle("hidden", state.user?.role !== "system_admin");
  const canManage = canManageCurrentUser();
  $("#roomForm").classList.toggle("hidden", !canManage);
  $("#deviceForm").classList.toggle("hidden", !canManage);
  $("#userForm").classList.toggle("hidden", !canManage);
  $("#alertSettingsForm").classList.toggle("hidden", !canManage);
  $("#managementTab").classList.toggle("hidden", !canManage);
  $("#userRoleSelect").innerHTML = state.user?.role === "system_admin"
    ? `<option value="hospital_admin">ผู้ดูแล รพ.</option><option value="staff">เจ้าหน้าที่</option><option value="auditor">ผู้ตรวจสอบ</option>`
    : `<option value="staff">เจ้าหน้าที่</option><option value="auditor">ผู้ตรวจสอบ</option>`;
  const rooms = state.rooms.filter(item => item.hospitalId === selectedHospitalId());
  $("#roomSelect").innerHTML = rooms.map(item => `<option value="${item.id}">${item.name}</option>`).join("");
  if (rooms.some(item => item.id === currentRoomId)) $("#roomSelect").value = currentRoomId;
  $("#deviceRoomSelect").innerHTML = rooms.length
    ? rooms.map(item => `<option value="${item.id}">${item.name}</option>`).join("")
    : `<option value="">ยังไม่มีห้อง กรุณาเพิ่มห้องก่อน</option>`;
  if (rooms.some(item => item.id === currentRoomId)) $("#deviceRoomSelect").value = currentRoomId;
  renderAlertSettings();
  renderCrudLists();
  showPage(state.currentPage);
}

function renderAlertSettings() {
  const hospital = selectedHospital();
  if (!hospital || !$("#alertSettingsForm")) return;
  $("#alertSettingsForm").elements.lineChannelAccessToken.value = hospital.lineChannelAccessToken || "";
  $("#alertSettingsForm").elements.lineTo.value = hospital.lineTo || "";
  $("#alertSettingsForm").elements.alertWebhookUrl.value = hospital.alertWebhookUrl || "";
  $("#alertSettingsForm").elements.alertWebhookToken.value = hospital.alertWebhookToken || "";
  $("#alertSettingsForm").elements.alertCooldownMinutes.value = hospital.alertCooldownMinutes ?? 30;
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

function roleLabel(role) {
  return {
    system_admin: "ผู้ดูแลระบบ",
    hospital_admin: "ผู้ดูแล รพ.",
    staff: "เจ้าหน้าที่",
    auditor: "ผู้ตรวจสอบ"
  }[role] || role;
}

function actionButtons(type, id, canDelete = true) {
  return `<div class="row-actions">
    <button class="secondary-button" type="button" data-crud-action="edit" data-crud-type="${type}" data-id="${id}">แก้ไข</button>
    ${canDelete ? `<button class="danger-button" type="button" data-crud-action="delete" data-crud-type="${type}" data-id="${id}">ลบ</button>` : ""}
  </div>`;
}

function renderCrudLists() {
  if (!$("#hospitalCrudList")) return;
  const hospitalId = selectedHospitalId();
  const rooms = state.rooms.filter(item => item.hospitalId === hospitalId);
  const devices = state.devices.filter(item => item.hospitalId === hospitalId);
  const users = state.users.filter(item => item.hospitalId === hospitalId);
  const roomName = id => state.rooms.find(room => room.id === id)?.name || "-";

  $("#hospitalCrud").classList.toggle("hidden", state.user?.role !== "system_admin");
  $("#hospitalCrudList").innerHTML = state.hospitals.length
    ? state.hospitals.map(hospital => `<div class="crud-row">
        <div><b>${escapeHtml(hospital.name)}</b><span>${escapeHtml(hospital.code || "-")}</span></div>
        ${actionButtons("hospital", hospital.id)}
      </div>`).join("")
    : "<p>ยังไม่มีโรงพยาบาล</p>";

  $("#roomCrudList").innerHTML = rooms.length
    ? rooms.map(room => `<div class="crud-row">
        <div><b>${escapeHtml(room.name)}</b><span>Temp ${room.tempMin}-${room.tempMax} °C / RH ${room.rhMin}-${room.rhMax} %</span></div>
        ${actionButtons("room", room.id)}
      </div>`).join("")
    : "<p>ยังไม่มีห้องในโรงพยาบาลนี้</p>";

  $("#deviceCrudList").innerHTML = devices.length
    ? devices.map(device => `<div class="crud-row">
        <div><b>${escapeHtml(device.name)}</b><span>${escapeHtml(roomName(device.roomId))} / ${escapeHtml(device.deviceId || "-")}</span></div>
        ${actionButtons("device", device.id)}
      </div>`).join("")
    : "<p>ยังไม่มี ESP ในโรงพยาบาลนี้</p>";

  $("#userCrudList").innerHTML = users.length
    ? users.map(user => `<div class="crud-row">
        <div><b>${escapeHtml(user.name)}</b><span>${escapeHtml(user.email)} / ${escapeHtml(roleLabel(user.role))}</span></div>
        ${actionButtons("user", user.id)}
      </div>`).join("")
    : "<p>ยังไม่มีผู้ใช้ของโรงพยาบาลนี้</p>";
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
  renderLatestReadings(state.readings);

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

$("#dashboardTab").addEventListener("click", () => showPage("dashboard"));
$("#managementTab").addEventListener("click", () => showPage("management"));

$("#hospitalSelect").addEventListener("change", () => {
  renderSelectors();
  loadDashboard();
});
$("#roomSelect").addEventListener("change", loadDashboard);
$("#monthPicker").addEventListener("change", loadDashboard);

$("#hospitalForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  await api("/api/hospitals", { method: "POST", body: JSON.stringify({ name: form.get("name"), code: form.get("code") }) });
  formElement.reset();
  await refreshAll();
});

$("#roomForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
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
  formElement.reset();
  await refreshAll();
});

$("#deviceForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const message = $("#deviceFormMessage");
  const button = formElement.querySelector("button[type='submit']");
  message.textContent = "";
  const form = new FormData(formElement);
  const roomId = String(form.get("roomId") || selectedRoomId() || "");
  if (!roomId) {
    message.textContent = "กรุณาเพิ่มห้องก่อนสร้าง Device Key";
    message.className = "form-message error";
    return;
  }
  button.disabled = true;
  try {
    const result = await api("/api/devices", {
      method: "POST",
      body: JSON.stringify({
        hospitalId: selectedHospitalId(),
        roomId,
        name: form.get("name"),
        deviceId: form.get("deviceId")
      })
    });
    formElement.reset();
    await refreshAll();
    $("#deviceRoomSelect").value = roomId;
    message.textContent = `สร้าง Device Key แล้ว: ${result.device.deviceKey}`;
    message.className = "form-message success";
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error";
  } finally {
    button.disabled = false;
  }
});

async function editHospital(id) {
  const hospital = state.hospitals.find(item => item.id === id);
  if (!hospital) return;
  const name = prompt("ชื่อโรงพยาบาล", hospital.name);
  if (name === null) return;
  const code = prompt("รหัสโรงพยาบาล", hospital.code || "");
  if (code === null) return;
  await api(`/api/hospitals/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ name, code })
  });
}

async function editRoom(id) {
  const room = state.rooms.find(item => item.id === id);
  if (!room) return;
  const name = prompt("ชื่อห้อง", room.name);
  if (name === null) return;
  const tempMin = prompt("Temp ต่ำสุด °C", room.tempMin);
  if (tempMin === null) return;
  const tempMax = prompt("Temp สูงสุด °C", room.tempMax);
  if (tempMax === null) return;
  const rhMin = prompt("RH ต่ำสุด %", room.rhMin);
  if (rhMin === null) return;
  const rhMax = prompt("RH สูงสุด %", room.rhMax);
  if (rhMax === null) return;
  await api(`/api/rooms/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ name, tempMin: Number(tempMin), tempMax: Number(tempMax), rhMin: Number(rhMin), rhMax: Number(rhMax) })
  });
}

async function editDevice(id) {
  const device = state.devices.find(item => item.id === id);
  if (!device) return;
  const name = prompt("ชื่อ ESP", device.name);
  if (name === null) return;
  const deviceId = prompt("Device ID", device.deviceId || device.name);
  if (deviceId === null) return;
  const rooms = state.rooms.filter(item => item.hospitalId === device.hospitalId);
  const currentRoom = rooms.find(item => item.id === device.roomId);
  const roomText = prompt("ชื่อห้องของ ESP", currentRoom?.name || "");
  if (roomText === null) return;
  const nextRoom = rooms.find(item => item.name === roomText.trim()) || currentRoom;
  await api(`/api/devices/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ name, deviceId, roomId: nextRoom?.id || device.roomId })
  });
}

async function editUser(id) {
  const target = state.users.find(item => item.id === id);
  if (!target) return;
  const name = prompt("ชื่อผู้ใช้", target.name);
  if (name === null) return;
  const email = prompt("email", target.email);
  if (email === null) return;
  const role = prompt("สิทธิ์: hospital_admin, staff, auditor", target.role);
  if (role === null) return;
  const password = prompt("รหัสผ่านใหม่ ถ้าไม่เปลี่ยนให้เว้นว่าง", "");
  if (password === null) return;
  await api(`/api/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ name, email, role, password })
  });
}

async function deleteCrudItem(type, id) {
  const labels = { hospital: "โรงพยาบาล", room: "ห้อง", device: "ESP", user: "ผู้ใช้" };
  if (!confirm(`ลบ${labels[type] || "รายการนี้"}ออกจากระบบ?`)) return;
  await api(`/api/${type === "hospital" ? "hospitals" : `${type}s`}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: "{}"
  });
}

$("#managementPage").addEventListener("click", async event => {
  const button = event.target.closest("[data-crud-action]");
  if (!button) return;
  const { crudAction, crudType, id } = button.dataset;
  button.disabled = true;
  try {
    if (crudAction === "delete") {
      await deleteCrudItem(crudType, id);
    } else if (crudType === "hospital") {
      await editHospital(id);
    } else if (crudType === "room") {
      await editRoom(id);
    } else if (crudType === "device") {
      await editDevice(id);
    } else if (crudType === "user") {
      await editUser(id);
    }
    await refreshAll();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

$("#userForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      hospitalId: selectedHospitalId(),
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role")
    })
  });
  formElement.reset();
  await refreshAll();
});

$("#alertSettingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  await api("/api/hospitals/alert-settings", {
    method: "POST",
    body: JSON.stringify({
      hospitalId: selectedHospitalId(),
      lineChannelAccessToken: form.get("lineChannelAccessToken"),
      lineTo: form.get("lineTo"),
      alertWebhookUrl: form.get("alertWebhookUrl"),
      alertWebhookToken: form.get("alertWebhookToken"),
      alertCooldownMinutes: Number(form.get("alertCooldownMinutes"))
    })
  });
  await refreshAll();
});

$("#testAlertButton").addEventListener("click", async () => {
  await api(`/api/notifications/test?hospitalId=${encodeURIComponent(selectedHospitalId())}`, {
    method: "POST",
    body: "{}"
  });
  alert("ส่งทดสอบแจ้งเตือนแล้ว");
});

$("#manualForm").addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
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
  formElement.reset();
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
