import { DatabaseSync } from "node:sqlite";

class SQLitePreparedStatement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SQLitePreparedStatement(this.owner, this.sql, bindings);
  }

  first() {
    const row = this.owner.raw.prepare(this.sql).get(...this.bindings);
    return row ?? null;
  }

  all() {
    const results = this.owner.raw.prepare(this.sql).all(...this.bindings);
    return { success: true, results };
  }

  run() {
    const result = this.owner.raw.prepare(this.sql).run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }
}

export class SQLiteD1 {
  constructor({ beforeBatch = null } = {}) {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.beforeBatch = beforeBatch;
    this.batchCount = 0;
  }

  prepare(sql) {
    return new SQLitePreparedStatement(this, sql);
  }

  async batch(statements) {
    this.batchCount += 1;
    if (this.beforeBatch) await this.beforeBatch(this, statements, this.batchCount);

    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  close() {
    this.raw.close();
  }
}
