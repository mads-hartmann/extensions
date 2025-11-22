import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import * as fs from "fs";
import * as path from "path";
import { environment } from "@raycast/api";

let dbInstance: Database | null = null;

/**
 * Initialize SQL.js and load the database
 */
async function initDatabase(dbPath: string): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    // Initialize SQL.js
    const wasmBuffer = await fs.promises.readFile(path.join(environment.assetsPath, "sql-wasm.wasm"));
    const wasmBinary = new Uint8Array(wasmBuffer).buffer;
    const SQL = await initSqlJs({ wasmBinary });

    // Check if database file exists
    let dbBuffer: Buffer | undefined;
    if (fs.existsSync(dbPath)) {
      dbBuffer = fs.readFileSync(dbPath);
    }

    // Create or load database
    if (dbBuffer) {
      dbInstance = new SQL.Database(dbBuffer);
    } else {
      dbInstance = new SQL.Database();
    }

    // Create schema if tables don't exist
    createSchema();

    return dbInstance;
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

/**
 * Create database schema
 */
function createSchema(): void {
  if (!dbInstance) return;

  // Metadata table
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Playlists table
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      data JSON NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `);

  // Albums table
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      data JSON NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `);

  // Artists table
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      data JSON NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `);

  // Tracks table
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      data JSON NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `);

  // Shows table
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS shows (
      id TEXT PRIMARY KEY,
      data JSON NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `);

  // Episodes table
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      data JSON NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `);
}

/**
 * Get database instance, initializing if necessary
 */
export async function getDatabase(dbPath: string): Promise<Database> {
  if (!dbInstance) {
    await initDatabase(dbPath);
  }
  return dbInstance!;
}

/**
 * Check if database is empty (no data in any table)
 */
export async function isDatabaseEmpty(dbPath: string): Promise<boolean> {
  try {
    const db = await getDatabase(dbPath);

    const playlistsCount = db.exec("SELECT COUNT(*) as count FROM playlists");
    const albumsCount = db.exec("SELECT COUNT(*) as count FROM albums");
    const artistsCount = db.exec("SELECT COUNT(*) as count FROM artists");
    const tracksCount = db.exec("SELECT COUNT(*) as count FROM tracks");
    const showsCount = db.exec("SELECT COUNT(*) as count FROM shows");
    const episodesCount = db.exec("SELECT COUNT(*) as count FROM episodes");

    const getCount = (result: any[]): number => {
      if (result.length === 0 || !result[0].values || result[0].values.length === 0) {
        return 0;
      }
      return result[0].values[0][0] as number;
    };

    const total =
      getCount(playlistsCount) +
      getCount(albumsCount) +
      getCount(artistsCount) +
      getCount(tracksCount) +
      getCount(showsCount) +
      getCount(episodesCount);

    return total === 0;
  } catch (error) {
    console.error("Error checking if database is empty:", error);
    return true; // Assume empty on error
  }
}

/**
 * Execute a query and return results
 */
export async function executeQuery(dbPath: string, sql: string, params: any[] = []): Promise<any[]> {
  try {
    const db = await getDatabase(dbPath);
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: any[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject({});
      results.push(row);
    }

    stmt.free();
    return results;
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  }
}

/**
 * Execute a write operation (INSERT, UPDATE, DELETE)
 */
export async function executeWrite(dbPath: string, sql: string, params: any[] = []): Promise<void> {
  try {
    const db = await getDatabase(dbPath);
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
    saveDatabase(dbPath);
  } catch (error) {
    console.error("Error executing write:", error);
    throw error;
  }
}

/**
 * Execute multiple writes in a transaction
 */
export async function executeTransaction(
  dbPath: string,
  operations: Array<{ sql: string; params: any[] }>,
): Promise<void> {
  try {
    const db = await getDatabase(dbPath);
    db.run("BEGIN TRANSACTION");

    for (const op of operations) {
      const stmt = db.prepare(op.sql);
      stmt.bind(op.params);
      stmt.step();
      stmt.free();
    }

    db.run("COMMIT");
    saveDatabase(dbPath);
  } catch (error) {
    console.error("Error executing transaction:", error);
    if (dbInstance) {
      dbInstance.run("ROLLBACK");
    }
    throw error;
  }
}

/**
 * Save database to file
 */
export function saveDatabase(dbPath: string): void {
  if (!dbInstance) return;

  try {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write database to file
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (error) {
    console.error("Error saving database:", error);
    throw error;
  }
}

/**
 * Clear all data from cache tables
 */
export async function clearCache(dbPath: string): Promise<void> {
  try {
    const db = await getDatabase(dbPath);
    db.run("DELETE FROM playlists");
    db.run("DELETE FROM albums");
    db.run("DELETE FROM artists");
    db.run("DELETE FROM tracks");
    db.run("DELETE FROM shows");
    db.run("DELETE FROM episodes");
    saveDatabase(dbPath);
  } catch (error) {
    console.error("Error clearing cache:", error);
    throw error;
  }
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Get metadata value
 */
export async function getMetadata(dbPath: string, key: string): Promise<string | null> {
  try {
    const results = await executeQuery(dbPath, "SELECT value FROM metadata WHERE key = ?", [key]);
    if (results.length > 0) {
      return results[0].value as string;
    }
    return null;
  } catch (error) {
    console.error("Error getting metadata:", error);
    return null;
  }
}

/**
 * Set metadata value
 */
export async function setMetadata(dbPath: string, key: string, value: string): Promise<void> {
  try {
    await executeWrite(dbPath, "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", [key, value]);
  } catch (error) {
    console.error("Error setting metadata:", error);
    throw error;
  }
}
