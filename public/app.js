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

const monthPicker = document.querySelector("#monthPicker");
const thaiYear = document.querySelector("#thaiYear");
const deviceStatus = document.querySelector("#deviceStatus");
const manualForm = document.querySelector("#manualForm");

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
  const [year] = month.split("-").map(Number);
  return String(year + 543);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function format(value, decimals = 1) {
  return Number.isFinite(value) ? value.toFixed(decimals) : "-";
}

function tempLevel(value) {
  if (!Number.isFinite(value)) return null;
  if (value > 28) return "critical";
  if (value > 26) return "high";
  if (value > 24) return "caution";
  if (value >= 20) return "normal";
  return "low";
}

function rhLevel(value) {
  if (!Number.isFinite(value)) return null;
  if (value > 70) return "critical";
  if (value > 65) return "high";
  if (value > 60) return "caution";
  if (value >= 30) return "normal";
  return "low";
}

function overallLevel(day) {
  const levels = [tempLevel(day.temperature), rhLevel(day.humidity)];
  if (levels.includes("critical")) return "critical";
  if (levels.includes("high")) return "high";
  if (levels.includes("caution")) return "caution";
  if (levels.includes("low")) return "critical";
  return "normal";
}

function groupDaily(readings, month) {
  const days = daysInMonth(month);
  const result = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    temperature: null,
    humidity: null,
    count: 0,
    deviceId: ""
  }));

  readings.forEach(reading => {
    const dt = new Date(reading.timestamp);
    const day = dt.getDate();
    const slot = result[day - 1];
    if (!slot) return;
    slot.tempValues = slot.tempValues || [];
    slot.rhValues = slot.rhValues || [];
    slot.tempValues.push(Number(reading.temperature));
    slot.rhValues.push(Number(reading.humidity));
    slot.count += 1;
    slot.deviceId = reading.deviceId || slot.deviceId;
  });

  result.forEach(day => {
    day.temperature = mean(day.tempValues || []);
    day.humidity = mean(day.rhValues || []);
    delete day.tempValues;
    delete day.rhValues;
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
        reading.title = `วันที่ ${day.day}: ${format(value)}`;
        cell.appendChild(reading);
      }
      target.appendChild(cell);
    });
  });
}

function setText(id, value) {
  document.querySelector(id).textContent = value;
}

function drawSummary(days) {
  const available = days.filter(day => Number.isFinite(day.temperature) && Number.isFinite(day.humidity));
  const tempValues = available.map(day => day.temperature);
  const rhValues = available.map(day => day.humidity);
  setText("#maxTemp", format(Math.max(...tempValues)));
  setText("#minTemp", format(Math.min(...tempValues)));
  setText("#avgTemp", format(mean(tempValues)));
  setText("#maxRh", format(Math.max(...rhValues)));
  setText("#minRh", format(Math.min(...rhValues)));
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

  const summaryCards = document.querySelector("#summaryCards");
  summaryCards.innerHTML = "";
  cards.forEach(card => {
    const percent = available.length ? (counts[card.key] / available.length) * 100 : 0;
    const node = document.createElement("article");
    node.className = `summary-card ${card.className}`;
    node.innerHTML = `
      <b>${card.title}</b>
      <p>จำนวนวัน ${counts[card.key]} วัน</p>
      <p>คิดเป็น ${format(percent, 0)} %</p>
    `;
    summaryCards.appendChild(node);
  });
}

async function loadDashboard() {
  const month = monthPicker.value || currentMonth();
  thaiYear.value = toThaiYear(month);
  deviceStatus.textContent = "กำลังโหลดข้อมูล...";

  const response = await fetch(`/api/readings?month=${encodeURIComponent(month)}`);
  const payload = await response.json();
  const days = groupDaily(payload.readings || [], month);
  drawGrid(document.querySelector("#tempGrid"), tempRows, days, day => day.temperature, tempLevel);
  drawGrid(document.querySelector("#humidityGrid"), rhRows, days, day => day.humidity, rhLevel);
  drawSummary(days);

  const latest = [...(payload.readings || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  deviceStatus.textContent = latest
    ? `${latest.deviceId} ส่งข้อมูลล่าสุด ${new Date(latest.timestamp).toLocaleString("th-TH")}`
    : "ยังไม่มีข้อมูลในเดือนนี้";
}

monthPicker.value = currentMonth();
monthPicker.addEventListener("change", loadDashboard);

manualForm.addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(manualForm);
  await fetch("/api/readings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "WEB-TEST",
      temperature: Number(form.get("temperature")),
      humidity: Number(form.get("humidity")),
      timestamp: new Date().toISOString()
    })
  });
  manualForm.reset();
  await loadDashboard();
});

loadDashboard().catch(error => {
  deviceStatus.textContent = `โหลดข้อมูลไม่ได้: ${error.message}`;
});
