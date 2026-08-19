const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectDir = path.resolve(__dirname, "..");

async function startServer(dataDir, port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      MQTT_ENABLED: "false",
      ADMIN_EMAIL: "test@example.com",
      ADMIN_PASSWORD: "test-password"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server stopped before startup:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, baseUrl };
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill("SIGTERM");
  throw new Error(`Server did not start:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => {
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000).unref();
  });
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      password: "test-password"
    })
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("server stores readings in SQLite and retains them after restart", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sterile-server-"));
  const port = 32000 + Math.floor(Math.random() * 1000);
  let running = await startServer(dataDir, port);

  try {
    const health = await fetch(`${running.baseUrl}/api/health`).then(response => response.json());
    assert.equal(health.storage, "sqlite");
    assert.equal(health.dbFile, path.join(dataDir, "saas.db"));

    let cookie = await login(running.baseUrl);
    const bootstrap = await fetch(`${running.baseUrl}/api/bootstrap`, {
      headers: { cookie }
    }).then(response => response.json());
    const device = bootstrap.devices[0];
    assert.ok(device?.deviceKey);

    const readingResponse = await fetch(`${running.baseUrl}/api/readings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: device.deviceId,
        deviceKey: device.deviceKey,
        temperature: 22.5,
        humidity: 50
      })
    });
    assert.equal(readingResponse.status, 201);

    await stopServer(running.child);
    running = await startServer(dataDir, port);
    cookie = await login(running.baseUrl);
    const afterRestart = await fetch(`${running.baseUrl}/api/bootstrap`, {
      headers: { cookie }
    }).then(response => response.json());
    const hospitalId = afterRestart.hospitals[0].id;
    assert.equal(afterRestart.managementStats.hospitals[hospitalId].readings, 1);
  } finally {
    await stopServer(running.child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("MOPH Notify uses the documented endpoint, headers, and messages body", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sterile-moph-"));
  const appPort = 33000 + Math.floor(Math.random() * 500);
  const notifyPort = 33500 + Math.floor(Math.random() * 500);
  let received = null;
  const notifyServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      received = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise(resolve => notifyServer.listen(notifyPort, "127.0.0.1", resolve));
  const running = await startServer(dataDir, appPort);

  try {
    const cookie = await login(running.baseUrl);
    const bootstrap = await fetch(`${running.baseUrl}/api/bootstrap`, {
      headers: { cookie }
    }).then(response => response.json());
    const hospitalId = bootstrap.hospitals[0].id;

    const settingsResponse = await fetch(`${running.baseUrl}/api/hospitals/alert-settings`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        hospitalId,
        mophNotifyBaseUrl: `http://127.0.0.1:${notifyPort}/api/notify/send`,
        mophNotifyClientKey: "client-key-test",
        mophNotifySecretKey: "secret-key-test",
        alertCooldownMinutes: 30
      })
    });
    assert.equal(settingsResponse.status, 200);

    const testResponse = await fetch(
      `${running.baseUrl}/api/notifications/test?hospitalId=${encodeURIComponent(hospitalId)}`,
      { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }
    );
    assert.equal(testResponse.status, 200);
    assert.equal(received.url, "/api/notify/send");
    assert.equal(received.headers["client-key"], "client-key-test");
    assert.equal(received.headers["secret-key"], "secret-key-test");
    assert.equal(received.headers["content-type"], "application/json");
    assert.equal(Array.isArray(received.body.messages), true);
    assert.equal(received.body.messages[0].type, "flex");
    assert.equal("to" in received.body, false);
  } finally {
    await stopServer(running.child);
    await new Promise(resolve => notifyServer.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
