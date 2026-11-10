/**
 * Minimal Cloudflare D1 shim for the test suite.
 *
 * Node 20 has no built-in SQLite, so this executes real SQL against the
 * `sqlite3` CLI (already present in the environment). It implements the subset
 * of the D1 API that the backend actually uses:
 *
 *   db.prepare(sql).bind(...params).first()   -> row | null
 *   db.prepare(sql).bind(...params).all()     -> { results: [] }
 *   db.prepare(sql).bind(...params).run()     -> { meta: { changes } }
 *   db.exec(sql)
 *
 * Parameters are interpolated as properly quoted SQL literals, skipping any
 * '?' that appears inside a string literal. This is a test-only harness; the
 * production code always uses real bound parameters.
 */

import { execFileSync } from "node:child_process";

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function interpolate(sql, params = []) {
  let out = "";
  let inString = false;
  let index = 0;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "?") {
      if (index >= params.length) {
        throw new Error(`SQL placeholder without a parameter: ${sql.slice(0, 120)}`);
      }
      out += literal(params[index]);
      index += 1;
      continue;
    }

    out += ch;
  }

  if (index !== params.length) {
    throw new Error(
      `Unused parameters (${params.length - index}) for SQL: ${sql.slice(0, 120)}`
    );
  }

  return out;
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  #rows(sql) {
    const output = this.db.run(sql).trim();
    if (output === "") return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [];
  }

  async first(column) {
    const rows = this.#rows(interpolate(this.sql, this.params));
    const row = rows[0] ?? null;
    if (row === null) return null;
    if (column !== undefined) return row[column] ?? null;
    return row;
  }

  async all() {
    return { results: this.#rows(interpolate(this.sql, this.params)), success: true };
  }

  async run() {
    const sql = interpolate(this.sql, this.params);
    const rows = this.#rows(`${sql};\nSELECT changes() AS changes;`);
    const last = rows[rows.length - 1] ?? {};
    return { success: true, meta: { changes: Number(last.changes ?? 0) } };
  }
}

export class D1Shim {
  constructor(path) {
    this.path = path;
  }

  run(sql) {
    return execFileSync("sqlite3", ["-json", this.path], {
      input: sql,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  exec(sql) {
    execFileSync("sqlite3", [this.path], {
      input: sql,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    return this;
  }

  /** Rows as plain objects, for assertions. */
  query(sql, params = []) {
    const output = this.run(interpolate(sql, params)).trim();
    return output === "" ? [] : JSON.parse(output);
  }
}
