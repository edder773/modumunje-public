import path from "node:path";
import { fileURLToPath } from "node:url";
import { is, SQL } from "drizzle-orm";
import {
  getTableConfig,
  SQLiteSyncDialect,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import * as schema from "../apps/backend/src/infrastructure/database/schema.ts";
import { openCanonicalDatabase } from "./lib/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dialect = new SQLiteSyncDialect();

function normalizeDefault(value) {
  if (value == null) return null;
  let normalized = String(value).trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (normalized.toLowerCase() === "true") return "1";
  if (normalized.toLowerCase() === "false") return "0";
  if (normalized.toLowerCase() === "current_timestamp") return "CURRENT_TIMESTAMP";
  return normalized;
}

function extractChecks(sql) {
  return Array.from(String(sql ?? "").matchAll(/\bCHECK\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/giu))
    .map((match) => match[1]
      .replaceAll(/[`"']/gu, "")
      .replaceAll(/\b[a-z_][a-z0-9_]*[.]/giu, "")
      .replaceAll(/\s+/gu, " ")
      .trim()
      .toLowerCase())
    .sort();
}

function normalizeExpression(value) {
  return String(value ?? "")
    .replaceAll(/[`"']/gu, "")
    .replaceAll(/\b[a-z_][a-z0-9_]*[.]/giu, "")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function compileSql(value, source) {
  const query = dialect.sqlToQuery(value, source);
  if (query.params.length > 0) {
    throw new Error(`schema metadata SQL must not contain parameters: ${query.sql}`);
  }
  return query.sql;
}

function modelDefault(value) {
  if (value == null) return null;
  if (is(value, SQL)) return normalizeDefault(compileSql(value));
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function modelIndexColumn(value) {
  if (!is(value, SQL)) return { descending: false, name: value.name };
  const compiled = compileSql(value, "indexes").trim();
  const column = compiled.match(/^(?:"[^"]+"[.])?"([^"]+)"(?:\s+(asc|desc))?$/iu);
  if (!column) return { descending: false, name: null };
  return {
    descending: column[2]?.toLowerCase() === "desc",
    name: column[1],
  };
}

function sortIndexes(indexes) {
  return indexes.sort((left, right) => {
    const leftKey = left.name ?? JSON.stringify(left);
    const rightKey = right.name ?? JSON.stringify(right);
    return leftKey.localeCompare(rightKey);
  });
}

function modelTableContract(table) {
  const config = getTableConfig(table);
  const compositePrimaryPositions = new Map();
  for (const primaryKey of config.primaryKeys) {
    primaryKey.columns.forEach((column, index) => {
      compositePrimaryPositions.set(column.name, index + 1);
    });
  }
  const columns = config.columns.map((column) => ({
    default: modelDefault(column.default),
    name: column.name,
    notNull: column.notNull || column.primary || compositePrimaryPositions.has(column.name),
    primaryKeyPosition: compositePrimaryPositions.get(column.name) ?? (column.primary ? 1 : 0),
    type: column.getSQLType().toLowerCase(),
  })).sort((left, right) => left.name.localeCompare(right.name));
  const foreignKeys = config.foreignKeys.flatMap((foreignKey) => {
    const reference = foreignKey.reference();
    return reference.columns.map((column, index) => ({
      from: column.name,
      onDelete: foreignKey.onDelete ?? "no action",
      onUpdate: foreignKey.onUpdate ?? "no action",
      table: getTableConfig(reference.foreignTable).name,
      to: reference.foreignColumns[index].name,
    }));
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const indexes = config.indexes.map((index) => ({
    columns: index.config.columns.map(modelIndexColumn),
    name: index.config.name,
    partial: Boolean(index.config.where),
    unique: index.config.unique,
  }));
  for (const column of config.columns.filter((candidate) => candidate.isUnique)) {
    indexes.push({
      columns: [{ descending: false, name: column.name }],
      name: column.uniqueName,
      partial: false,
      unique: true,
    });
  }
  for (const uniqueConstraint of config.uniqueConstraints) {
    indexes.push({
      columns: uniqueConstraint.columns.map((column) => ({
        descending: false,
        name: column.name,
      })),
      name: uniqueConstraint.getName() ?? null,
      partial: false,
      unique: true,
    });
  }
  const checks = config.checks
    .map((check) => normalizeExpression(compileSql(check.value)))
    .sort();
  return { checks, columns, foreignKeys, indexes: sortIndexes(indexes) };
}

function schemaContract() {
  const tables = Object.values(schema).filter((value) => is(value, SQLiteTable));
  return Object.fromEntries(tables
    .map((table) => [getTableConfig(table).name, modelTableContract(table)])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function tableContract(database, table) {
  const columns = database.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all()
    .map((column) => ({
      default: normalizeDefault(column.dflt_value),
      name: String(column.name),
      notNull: Boolean(column.notnull) || Number(column.pk) > 0,
      primaryKeyPosition: Number(column.pk),
      type: String(column.type).toLowerCase(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all()
    .map((foreignKey) => ({
      from: String(foreignKey.from),
      onDelete: String(foreignKey.on_delete).toLowerCase(),
      onUpdate: String(foreignKey.on_update).toLowerCase(),
      table: String(foreignKey.table),
      to: String(foreignKey.to),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const indexes = database.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all()
    .filter((index) => String(index.origin) !== "pk")
    .map((index) => ({
      columns: database.prepare(`PRAGMA index_xinfo(${JSON.stringify(index.name)})`).all()
        .filter((column) => Number(column.key) === 1)
        .map((column) => ({
          descending: Boolean(column.desc),
          name: column.name == null ? null : String(column.name),
        })),
      name: String(index.name).startsWith("sqlite_autoindex_") ? null : String(index.name),
      partial: Boolean(index.partial),
      unique: Boolean(index.unique),
    }))
    .sort((left, right) => {
      const leftKey = left.name ?? JSON.stringify(left);
      const rightKey = right.name ?? JSON.stringify(right);
      return leftKey.localeCompare(rightKey);
    });
  const createSql = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table)?.sql;
  return { checks: extractChecks(createSql), columns, foreignKeys, indexes };
}

function databaseContract(database) {
  const tables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
  `).all().map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, tableContract(database, table)]));
}

const migrated = openCanonicalDatabase(root);
try {
  const modelContract = schemaContract();
  const migratedContract = databaseContract(migrated);
  const failures = [];
  const details = {};
  for (const table of new Set([
    ...Object.keys(modelContract),
    ...Object.keys(migratedContract),
  ])) {
    if (!modelContract[table]) failures.push(`${table}: missing from schema.ts model`);
    else if (!migratedContract[table]) failures.push(`${table}: missing from migrated database`);
    else if (JSON.stringify(modelContract[table]) !== JSON.stringify(migratedContract[table])) {
      for (const section of ["checks", "columns", "foreignKeys", "indexes"]) {
        if (JSON.stringify(modelContract[table][section]) !== JSON.stringify(migratedContract[table][section])) {
          failures.push(`${table}.${section}: schema.ts differs from numbered migrations`);
          if (process.argv.includes("--details")) {
            details[`${table}.${section}`] = {
              model: modelContract[table][section],
              migrated: migratedContract[table][section],
            };
          }
        }
      }
    }
  }
  console.log(JSON.stringify({
    result: failures.length === 0 ? "pass" : "fail",
    tableCount: Object.keys(migratedContract).length,
    failures,
    ...(process.argv.includes("--details") ? { details } : {}),
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  migrated.close();
}
