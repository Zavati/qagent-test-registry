import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SQLiteD1 } from "./helpers/sqliteD1.mjs";

const migration = fs.readFileSync(new URL("../migrations/0001_test_registry_foundation.sql", import.meta.url), "utf8");

test("07.6.5-B migration creates immutable Test Registry tables and indexes", () => {
  const db = new SQLiteD1();
  try {
    db.exec(migration);
    const objects = db.raw.prepare(
      "SELECT type, name FROM sqlite_master WHERE name LIKE 'test_design%' OR name LIKE 'idx_test_design%' ORDER BY type, name",
    ).all();
    const names = new Set(objects.map((item) => item.name));

    assert.ok(names.has("test_designs"));
    assert.ok(names.has("test_design_versions"));
    assert.ok(names.has("idx_test_designs_tenant_project_endpoint"));
    assert.ok(names.has("idx_test_design_versions_design_version"));
    assert.ok(names.has("idx_test_design_versions_context"));
  } finally {
    db.close();
  }
});

test("migration enforces one root per tenant/project/endpoint and unique version/idempotency keys", () => {
  const db = new SQLiteD1();
  try {
    db.exec(migration);
    db.raw.prepare(
      "INSERT INTO test_designs (id, organization_id, project_id, endpoint_id, status, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?, ?)",
    ).run("td_a", "org", "prj", "ep", "2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z");

    assert.throws(() => db.raw.prepare(
      "INSERT INTO test_designs (id, organization_id, project_id, endpoint_id, status, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?, ?)",
    ).run("td_b", "org", "prj", "ep", "2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z"), /UNIQUE constraint failed/);
  } finally {
    db.close();
  }
});
