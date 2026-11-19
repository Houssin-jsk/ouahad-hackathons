import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import type { Database } from "./local-d1.ts";

const execute = promisify(execFile);
type Query = { sql: string; params: unknown[] };
type Send = <T>(queries: Query[]) => Promise<D1Result<T>[]>;

class RemoteStatement implements D1PreparedStatement {
  readonly query: Query;
  readonly send: Send;
  constructor(query: Query, send: Send) { this.query = query; this.send = send; }
  bind(...params: unknown[]) { return new RemoteStatement({ ...this.query, params }, this.send); }
  async all<T = Record<string, unknown>>() { return (await this.send<T>([this.query]))[0]!; }
  async run<T = Record<string, unknown>>() { return this.all<T>(); }
  first<T = unknown>(column: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(column?: string): Promise<T | null> {
    const row = (await this.all<Record<string, T>>()).results[0];
    return row ? (column ? row[column] ?? null : row as T) : null;
  }
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const { results } = await this.all<Record<string, unknown>>();
    const columns = Object.keys(results[0] ?? {});
    const rows = results.map((row) => columns.map((column) => row[column]) as T);
    return options?.columnNames ? [columns, ...rows] : rows;
  }
}

// Owner CLI only. cf resolves its own OAuth profile; credentials never enter this adapter or logs.
// No public HTTP route uses this adapter. Every batch is one atomic D1 /query request.
export async function openRemoteD1(id: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Expected an explicit remote D1 UUID");
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("cf/package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { bin: { cf: string } };
  const executable = new URL(pkg.bin.cf, pathToFileURL(packagePath));
  const folder = await mkdtemp(join(tmpdir(), "ouahad-owner-d1-"));
  const send: Send = async <T>(queries: Query[]) => {
    const path = join(folder, crypto.randomUUID() + ".json");
    try {
      await writeFile(path, JSON.stringify(queries), { mode: 0o600 });
      const { stdout } = await execute(process.execPath, [fileURLToPath(executable),
        "d1", "query", id, "--batch", "@" + path], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      const result = JSON.parse(stdout) as D1Result<T>[];
      if (result.length !== queries.length || result.some((row) => !row.success)) throw new Error("Remote D1 batch failed");
      return result;
    } catch {
      // Do not echo SQL, parameters, provider responses or the process environment on failure.
      throw new Error("Remote D1 command failed. Check cf authentication, database ID and migration state.");
    } finally { await rm(path, { force: true }); }
  };
  const db: Database = {
    prepare: (sql) => new RemoteStatement({ sql, params: [] }, send),
    batch: async (statements) => send(statements.map((statement) => {
      if (!(statement instanceof RemoteStatement)) throw new Error("Expected a remote D1 statement");
      return statement.query;
    })),
  };
  return { db, close: () => rm(folder, { recursive: true, force: true }) };
}
