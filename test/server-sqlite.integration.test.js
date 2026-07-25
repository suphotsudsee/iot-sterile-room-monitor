const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
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
