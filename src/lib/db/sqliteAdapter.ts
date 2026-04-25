/**
 * sqliteAdapter.ts — Runtime-detecting SQLite adapter (ESM).
 *
 * In Node.js: re-exports better-sqlite3 unchanged.
 * In Bun: wraps bun:sqlite to provide a better-sqlite3-compatible API.
 *
 * This allows OmniRoute to run with either runtime (node or bun --bun)
 * without changing any DB consumer code.
 *
 * Usage: import Database from "@/lib/db/sqliteAdapter";
 *        // Database behaves like better-sqlite3 in both runtimes.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Detect Bun runtime (Bun exposes a global `Bun` object)
const isBun: boolean =
    typeof (globalThis as Record<string, unknown>).Bun !== "undefined" &&
    (globalThis as Record<string, unknown>).Bun !== null;

// ─────────────────────────────────────────────────────────────
// Bun runtime — wrap bun:sqlite → better-sqlite3-compatible API
// ─────────────────────────────────────────────────────────────

function createBunAdapter() {
    // bun:sqlite is externalized in next.config.mjs so webpack/turbopack
    // treat it as external. At runtime, Bun provides it natively.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BunDatabase = require("bun:sqlite").Database as new (
        filename: string,
        opts?: Record<string, unknown>
    ) => {
        prepare(sql: string): BunStmt;
        exec(sql: string): void;
        transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
        serialize(): Uint8Array;
        close(): void;
        run(sql: string, ...params: unknown[]): void;
    };

    const { writeFileSync, existsSync, statSync } = require("node:fs");

    type JsonRecord = Record<string, unknown>;

    interface BunStmt {
        all(...params: unknown[]): unknown[];
        get(...params: unknown[]): unknown | null;
        run(...params: unknown[]): void;
    }

    // Utility: statements in better-sqlite3 have .all/.get/.run.
    // bun:sqlite also has these, but .run() returns void instead of
    // { changes, lastInsertRowid }. We wrap .run() to match.
    function wrapStatement(bunStmt: BunStmt) {
        return {
            all(...params: unknown[]): JsonRecord[] {
                return bunStmt.all(...params) as JsonRecord[];
            },
            get(...params: unknown[]): JsonRecord | undefined {
                const row = bunStmt.get(...params);
                // bun:sqlite returns null for no row; better-sqlite3 returns undefined.
                return (row ?? undefined) as JsonRecord | undefined;
            },
            run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
                bunStmt.run(...params);
                return { changes: 0, lastInsertRowid: 0 };
            },
        };
    }

    // PRAGMAs that return result rows (must use .prepare().all() or the value keyword).
    // SET pragmas (containing '=') are dispatched to .run().
    // Everything else uses .prepare().all() to read back.
    function isReadPragma(pragmaSql: string): boolean {
        const upper = pragmaSql.trim().toUpperCase();
        // If it contains '=', it's a SET pragma
        if (upper.includes("=")) return false;
        // Otherwise, it likely returns rows (integrity_check, table_info, etc.)
        return true;
    }

    class BunSqliteAdapter {
        private _db: InstanceType<typeof BunDatabase>;
        private _closed: boolean;

        constructor(filename: string, options?: Record<string, unknown>) {
            const bunOpts: Record<string, unknown> = {};

            if (options?.readonly) {
                bunOpts.readonly = true;
            }
            if (options?.create === false) {
                bunOpts.create = false;
            }
            if (options?.fileMustExist) {
                bunOpts.create = false;
                if (!existsSync(filename)) {
                    throw new Error(`Database file does not exist: ${filename} (fileMustExist was set)`);
                }
                if (statSync(filename).size === 0) {
                    throw new Error(`Database file is empty: ${filename} (fileMustExist was set)`);
                }
            }

            // Bun's Database constructor throws SQLITE_MISUSE when passed an empty
            // options object. Only pass options when at least one key is present.
            if (Object.keys(bunOpts).length > 0) {
                this._db = new BunDatabase(filename, bunOpts);
            } else {
                this._db = new BunDatabase(filename);
            }
            this._closed = false;
        }

        prepare(sql: string) {
            this._checkOpen();
            return wrapStatement(this._db.prepare(sql));
        }

        exec(sql: string): this {
            this._checkOpen();
            this._db.exec(sql);
            return this;
        }

        pragma(sql: string): unknown {
            this._checkOpen();
            const pragmaSql = sql.trim().toUpperCase().startsWith("PRAGMA")
                ? sql.trim()
                : `PRAGMA ${sql.trim()}`;

            if (isReadPragma(pragmaSql)) {
                return this._db.prepare(pragmaSql).all();
            }
            this._db.run(pragmaSql);
            return undefined;
        }

        transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
            this._checkOpen();
            const self = this;
            const wrapped = function(this: unknown, ...args: unknown[]) {
                return (self._db as Record<string, unknown>).transaction(() =>
                    fn.apply(this, args)
                )();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            return wrapped as unknown as T;
        }

        async backup(filePath: string): Promise<void> {
            this._checkOpen();
            const data = this._db.serialize();
            writeFileSync(filePath, data);
        }

        close(): void {
            if (this._closed) return;
            this._closed = true;
            this._db.close();
        }

        private _checkOpen(): void {
            if (this._closed) {
                throw new Error("Database is closed");
            }
        }
    }

    return BunSqliteAdapter;
}

// ─────────────────────────────────────────────────────────────
// Resolve and export the correct Database class
// ─────────────────────────────────────────────────────────────

let Database: unknown;

if (isBun) {
    Database = createBunAdapter();
} else {
    // Node.js — re-export better-sqlite3 unchanged.
    // better-sqlite3 is already in serverExternalPackages, so webpack
    // treats it as external. At runtime, Node.js provides it natively.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Database = require("better-sqlite3");
}

export default Database;
