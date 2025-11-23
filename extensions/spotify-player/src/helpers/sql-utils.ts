/**
 * SQL utilities for reading and writing to SQLite databases
 * Based on Raycast's executeSQL but extended to support writes
 * Uses node:sqlite (built-in Node.js module) or falls back to sqlite3 CLI
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import childProcess from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export function isPermissionError(error: unknown): error is PermissionError {
  return error instanceof Error && error.name === "PermissionError";
}

/**
 * Execute a SQL query and return results (read-only)
 * Similar to Raycast's executeSQL
 */
export async function executeSQL<T = unknown>(
  databasePath: string,
  query: string,
  options?: {
    signal?: AbortSignal;
  },
): Promise<T[]> {
  if (!existsSync(databasePath)) {
    throw new Error("The database does not exist");
  }

  let sqlite3: typeof import("node:sqlite");
  try {
    const dynamicImport = (module: string) => import(module);
    sqlite3 = await dynamicImport("node:sqlite");
  } catch (error) {
    // Fallback to sqlite3 CLI
    return sqliteFallback<T>(databasePath, query, options);
  }

  let db = new sqlite3.DatabaseSync(databasePath, { open: false, readOnly: true });

  const abortSignal = options?.signal;

  try {
    db.open();
  } catch (error: any) {
    if (error.message.match("(5)") || error.message.match("(14)")) {
      // DB is busy - use workaround
      const workaroundCopiedDb = await createWorkaroundDb(databasePath, abortSignal);
      db = new sqlite3.DatabaseSync(workaroundCopiedDb, { open: false, readOnly: true });
      db.open();
      checkAborted(abortSignal);
    }
  }

  const statement = db.prepare(query);
  checkAborted(abortSignal);

  const result = statement.all();

  db.close();

  return result as T[];
}

/**
 * Execute a write operation (INSERT, UPDATE, DELETE)
 * Opens database in read-write mode
 */
export async function executeWrite(
  databasePath: string,
  query: string,
  params: any[] = [],
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(databasePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  let sqlite3: typeof import("node:sqlite");
  try {
    const dynamicImport = (module: string) => import(module);
    sqlite3 = await dynamicImport("node:sqlite");
  } catch (error) {
    // Fallback to sqlite3 CLI for writes
    return sqliteFallbackWrite(databasePath, query, params, options);
  }

  let db = new sqlite3.DatabaseSync(databasePath, { open: false, readOnly: false });

  const abortSignal = options?.signal;

  try {
    db.open();
  } catch (error: any) {
    if (error.message.match("(5)") || error.message.match("(14)")) {
      // DB is busy - use workaround
      const workaroundCopiedDb = await createWorkaroundDb(databasePath, abortSignal);
      db = new sqlite3.DatabaseSync(workaroundCopiedDb, { open: false, readOnly: false });
      db.open();
      checkAborted(abortSignal);
    }
  }

  const statement = db.prepare(query);
  checkAborted(abortSignal);

  if (params.length > 0) {
    statement.bind(params);
  }

  statement.run();
  db.close();

  return;
}

/**
 * Execute multiple write operations in a transaction
 */
export async function executeTransaction(
  databasePath: string,
  operations: Array<{ query: string; params?: any[] }>,
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(databasePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  let sqlite3: typeof import("node:sqlite");
  try {
    const dynamicImport = (module: string) => import(module);
    sqlite3 = await dynamicImport("node:sqlite");
  } catch (error) {
    // Fallback to sqlite3 CLI
    return sqliteFallbackTransaction(databasePath, operations, options);
  }

  let db = new sqlite3.DatabaseSync(databasePath, { open: false, readOnly: false });

  const abortSignal = options?.signal;

  try {
    db.open();
  } catch (error: any) {
    if (error.message.match("(5)") || error.message.match("(14)")) {
      // DB is busy - use workaround
      const workaroundCopiedDb = await createWorkaroundDb(databasePath, abortSignal);
      db = new sqlite3.DatabaseSync(workaroundCopiedDb, { open: false, readOnly: false });
      db.open();
      checkAborted(abortSignal);
    }
  }

  try {
    db.exec("BEGIN TRANSACTION");
    checkAborted(abortSignal);

    for (const op of operations) {
      const statement = db.prepare(op.query);
      if (op.params && op.params.length > 0) {
        statement.bind(op.params);
      }
      statement.run();
      checkAborted(abortSignal);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Create database if it doesn't exist and initialize schema
 */
export async function initializeDatabase(
  databasePath: string,
  schema: string,
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const dir = path.dirname(databasePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // If database doesn't exist, create it by executing schema
  if (!existsSync(databasePath)) {
    await executeWrite(databasePath, schema, [], options);
  } else {
    // Database exists, but ensure schema is applied
    // This is a simple approach - you might want to use migrations instead
    try {
      await executeWrite(databasePath, schema, [], options);
    } catch (error) {
      // Schema might already exist, which is fine
      if (!(error instanceof Error && error.message.includes("already exists"))) {
        throw error;
      }
    }
  }
}

// Helper functions

function hash(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex").substring(0, 16);
}

async function createWorkaroundDb(databasePath: string, abortSignal?: AbortSignal): Promise<string> {
  const tempFolder = path.join(os.tmpdir(), "useSQL", hash(databasePath));
  await mkdir(tempFolder, { recursive: true });
  checkAborted(abortSignal);

  const workaroundCopiedDb = path.join(tempFolder, "db.db");
  await copyFile(databasePath, workaroundCopiedDb);

  await writeFile(workaroundCopiedDb + "-shm", "");
  await writeFile(workaroundCopiedDb + "-wal", "");

  checkAborted(abortSignal);

  return workaroundCopiedDb;
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
}

// Fallback implementations using sqlite3 CLI

async function sqliteFallback<T = unknown>(
  databasePath: string,
  query: string,
  options?: {
    signal?: AbortSignal;
  },
): Promise<T[]> {
  const abortSignal = options?.signal;

  let spawned = childProcess.spawn("sqlite3", ["--json", "--readonly", databasePath, query], { signal: abortSignal });
  let spawnedPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    spawned.on("close", (code, signal) => resolve({ exitCode: code, signal }));
    spawned.on("error", reject);
  });

  let stdout = "";
  let stderr = "";

  spawned.stdout?.on("data", (data) => {
    stdout += data.toString();
  });

  spawned.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  const { exitCode, signal } = await spawnedPromise;
  checkAborted(abortSignal);

  if (stderr.match("(5)") || stderr.match("(14)")) {
    // DB is busy - use workaround
    const workaroundCopiedDb = await createWorkaroundDb(databasePath, abortSignal);
    spawned = childProcess.spawn(
      "sqlite3",
      ["--json", "--readonly", "--vfs", "unix-none", workaroundCopiedDb, query],
      { signal: abortSignal },
    );
    spawnedPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      spawned.on("close", (code, signal) => resolve({ exitCode: code, signal }));
      spawned.on("error", reject);
    });

    stdout = "";
    stderr = "";

    spawned.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    spawned.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const result = await spawnedPromise;
    checkAborted(abortSignal);

    if (result.exitCode !== 0 || result.signal !== null) {
      if (stderr.includes("authorization denied")) {
        throw new PermissionError("You do not have permission to access the database.");
      } else {
        throw new Error(stderr || "Unknown error");
      }
    }

    return JSON.parse(stdout.trim() || "[]") as T[];
  }

  if (exitCode !== 0 || signal !== null) {
    if (stderr.includes("authorization denied")) {
      throw new PermissionError("You do not have permission to access the database.");
    } else {
      throw new Error(stderr || "Unknown error");
    }
  }

  return JSON.parse(stdout.trim() || "[]") as T[];
}

async function sqliteFallbackWrite(
  databasePath: string,
  query: string,
  params: any[] = [],
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const abortSignal = options?.signal;

  // Build query with parameters
  let finalQuery = query;
  if (params.length > 0) {
    // Simple parameter substitution (not production-ready, but works for basic cases)
    // For production, you'd want to properly escape parameters
    params.forEach((param, index) => {
      const value = typeof param === "string" ? `'${param.replace(/'/g, "''")}'` : param;
      finalQuery = finalQuery.replace("?", value);
    });
  }

  const spawned = childProcess.spawn("sqlite3", [databasePath, finalQuery], { signal: abortSignal });
  const spawnedPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    spawned.on("close", (code, signal) => resolve({ exitCode: code, signal }));
    spawned.on("error", reject);
  });

  let stderr = "";
  spawned.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  const { exitCode, signal } = await spawnedPromise;
  checkAborted(abortSignal);

  if (exitCode !== 0 || signal !== null) {
    if (stderr.includes("authorization denied")) {
      throw new PermissionError("You do not have permission to access the database.");
    } else {
      throw new Error(stderr || "Unknown error");
    }
  }
}

async function sqliteFallbackTransaction(
  databasePath: string,
  operations: Array<{ query: string; params?: any[] }>,
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const abortSignal = options?.signal;

  // Build transaction query
  const queries = ["BEGIN TRANSACTION", ...operations.map((op) => op.query), "COMMIT"];
  const finalQuery = queries.join("; ");

  const spawned = childProcess.spawn("sqlite3", [databasePath, finalQuery], { signal: abortSignal });
  const spawnedPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    spawned.on("close", (code, signal) => resolve({ exitCode: code, signal }));
    spawned.on("error", reject);
  });

  let stderr = "";
  spawned.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  const { exitCode, signal } = await spawnedPromise;
  checkAborted(abortSignal);

  if (exitCode !== 0 || signal !== null) {
    // Try to rollback
    const rollbackSpawned = childProcess.spawn("sqlite3", [databasePath, "ROLLBACK"], { signal: abortSignal });
    await new Promise((resolve) => rollbackSpawned.on("close", resolve));

    if (stderr.includes("authorization denied")) {
      throw new PermissionError("You do not have permission to access the database.");
    } else {
      throw new Error(stderr || "Unknown error");
    }
  }
}

