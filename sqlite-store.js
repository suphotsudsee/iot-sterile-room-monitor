const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const COLLECTIONS = [
  "hospitals",
  "rooms",
  "devices",
  "readings",
  "alerts",
  "lineWebhookEvents",
  "users",
  "auditLogs"
];

function isDatabaseDocument(value) {
  return value
    && typeof value === "object"
    && COLLECTIONS.some(name => Array.isArray(value[name]));
}

function parseLegacyJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (isDatabaseDocument(parsed)) return parsed;
  } catch {
    // Continue with recovery for files containing concatenated JSON documents.
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let latest = null;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const candidate = JSON.parse(raw.slice(start, index + 1));
          if (isDatabaseDocument(candidate)) latest = candidate;
        } catch {
          // Ignore incomplete documents and continue looking for a valid one.
        }
        start = -1;
      }
    }
  }

  if (!latest) {
    throw new Error("ไม่สามารถกู้ข้อมูลจาก saas-db.json ได้ เพราะไม่พบ JSON ที่สมบูรณ์");
  }
  return latest;
}

class SqliteStore {
  constructor({ dataDir, sqliteFile, legacyFile }) {
    this.dataDir = dataDir;
    this.sqliteFile = sqliteFile;
    this.legacyFile = legacyFile;
    this.database = null;
    this.snapshots = new WeakMap();
  }

  async initialize(createDefaultDatabase) {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.database = new DatabaseSync(this.sqliteFile);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      ${COLLECTIONS.map(name => `
        CREATE TABLE IF NOT EXISTS "${name}" (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
      `).join("\n")}
    `);

    const initialized = this.database
      .prepare("SELECT value FROM storage_meta WHERE key = ?")
      .get("initialized");
    if (initialized) return { source: "sqlite" };

    let initialDatabase;
    let source = "default";
    try {
      const raw = await fs.readFile(this.legacyFile, "utf8");
      initialDatabase = parseLegacyJson(raw);
      source = "legacy-json";
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      initialDatabase = createDefaultDatabase();
    }

    this.replaceAll(initialDatabase);
    this.database
      .prepare("INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)")
      .run("initialized", new Date().toISOString());
    this.database
      .prepare("INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)")
      .run("initial_source", source);
    return { source };
  }

  replaceAll(db) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const collection of COLLECTIONS) {
        this.database.exec(`DELETE FROM "${collection}"`);
        const insert = this.database.prepare(
          `INSERT INTO "${collection}" (id, data) VALUES (?, ?)`
        );
        for (const [index, item] of (db[collection] || []).entries()) {
          if (!item.id) item.id = `${collection}_${index}_${Date.now()}`;
          insert.run(String(item.id), JSON.stringify(item));
        }
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  readCollection(collection) {
    if (!COLLECTIONS.includes(collection)) throw new Error("Unknown collection");
    return this.database.prepare(`SELECT data FROM "${collection}" ORDER BY rowid`)
      .all().map(row => JSON.parse(row.data));
  }

  getById(collection, id) {
    if (!COLLECTIONS.includes(collection)) throw new Error("Unknown collection");
    const row = this.database.prepare(`SELECT data FROM "${collection}" WHERE id = ?`)
      .get(String(id));
    return row ? JSON.parse(row.data) : null;
  }

  load() {
    const db = {};
    const snapshot = {};
    for (const collection of COLLECTIONS) {
      const rows = this.database
        .prepare(`SELECT id, data FROM "${collection}" ORDER BY rowid`)
        .all();
      db[collection] = rows.map(row => JSON.parse(row.data));
      snapshot[collection] = new Map(rows.map(row => [String(row.id), row.data]));
    }
    this.snapshots.set(db, snapshot);
    return db;
  }

  save(db) {
    const snapshot = this.snapshots.get(db) || {};
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const collection of COLLECTIONS) {
        const previous = snapshot[collection] || new Map();
        const currentIds = new Set();
        const upsert = this.database.prepare(`
          INSERT INTO "${collection}" (id, data) VALUES (?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data
        `);
        const remove = this.database.prepare(
          `DELETE FROM "${collection}" WHERE id = ?`
        );

        for (const [index, item] of (db[collection] || []).entries()) {
          if (!item.id) item.id = `${collection}_${index}_${Date.now()}`;
          const itemId = String(item.id);
          const serialized = JSON.stringify(item);
          currentIds.add(itemId);
          if (previous.get(itemId) !== serialized) {
            upsert.run(itemId, serialized);
          }
        }

        for (const previousId of previous.keys()) {
          if (!currentIds.has(previousId)) remove.run(previousId);
        }
      }
      this.database.exec("COMMIT");
      this.snapshots.delete(db);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database?.close();
    this.database = null;
  }
}

module.exports = {
  COLLECTIONS,
  SqliteStore,
  parseLegacyJson
};
