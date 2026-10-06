const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { COLLECTIONS, SqliteStore } = require("../sqlite-store");

function databaseDocument(label) {
  return Object.fromEntries(COLLECTIONS.map(name => [name, []]));
}

test("migrates the latest complete legacy JSON document and persists changes", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sterile-sqlite-"));
  const legacyFile = path.join(dataDir, "saas-db.json");
  const sqliteFile = path.join(dataDir, "saas.db");
  const older = databaseDocument();
  older.hospitals.push({ id: "hosp_old", name: "Old hospital" });
  const latest = databaseDocument();
  latest.hospitals.push({ id: "hosp_new", name: "New hospital" });
  latest.readings.push({ id: "reading_1", temperature: 23, humidity: 50 });
  await fs.writeFile(
    legacyFile,
    `${JSON.stringify(older)}\n${JSON.stringify(latest)}\n`,
    "utf8"
  );

  const store = new SqliteStore({ dataDir, sqliteFile, legacyFile });
  const initialized = await store.initialize(() => {
    throw new Error("default database should not be used");
  });
  assert.equal(initialized.source, "legacy-json");

  const db = store.load();
  assert.equal(db.hospitals[0].id, "hosp_new");
  assert.equal(db.readings.length, 1);
  assert.deepEqual(store.getById("hospitals", "hosp_new"), db.hospitals[0]);
  assert.equal(store.getById("hospitals", "missing"), null);
  assert.deepEqual(store.readCollection("readings"), db.readings);
  assert.throws(() => store.readCollection("unknown"), /Unknown collection/);
  assert.throws(() => store.getById("unknown", "id"), /Unknown collection/);
  db.readings.push({ id: "reading_2", temperature: 24, humidity: 55 });
  store.save(db);
  store.close();

  const reopened = new SqliteStore({ dataDir, sqliteFile, legacyFile });
  const reopenedResult = await reopened.initialize(() => {
    throw new Error("default database should not be used after initialization");
  });
  assert.equal(reopenedResult.source, "sqlite");
  assert.deepEqual(
    reopened.load().readings.map(item => item.id),
    ["reading_1", "reading_2"]
  );
  reopened.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});
