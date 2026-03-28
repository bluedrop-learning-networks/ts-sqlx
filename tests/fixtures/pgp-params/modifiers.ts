// Test fixtures for pg-promise modifiers
// :raw (^), :value (#), :name (~), :alias, :json, :csv, :list
import { db } from "../db";

interface Params { table: string; column: string; value: string; data: object; ids: string[]; }

// --- :raw modifier (^) - raw text injection ---
const rawModifier = db.one<{ id: string }>("SELECT id FROM ${table:raw}", { table: "users" } as Params);
const rawShortcut = db.one<{ id: string }>("SELECT id FROM ${table^}", { table: "users" } as Params);

// --- :value modifier (#) - escaped without quotes ---
const valueModifier = db.one<{ id: string }>("SELECT ${column:value} FROM users", { column: "id" } as Params);
const valueShortcut = db.one<{ id: string }>("SELECT ${column#} FROM users", { column: "id" } as Params);

// --- :name modifier (~) - SQL identifier with quotes ---
const nameModifier = db.one<{ id: string }>("SELECT ${column:name} FROM users", { column: "id" } as Params);
const nameShortcut = db.one<{ id: string }>("SELECT ${column~} FROM users", { column: "id" } as Params);

// --- :alias modifier - less strict identifier ---
const aliasModifier = db.one<{ id: string }>("SELECT id AS ${alias:alias} FROM users", { alias: "user_id" });

// --- :json modifier - JSON formatting ---
const jsonModifier = db.one<{ id: number }>("INSERT INTO type_showcase (jsonb_col) VALUES (${data:json}) RETURNING id", { data: { key: "value" } } as Params);

// --- :csv / :list modifiers - comma-separated ---
const csvModifier = db.many<{ id: string }>("SELECT id FROM users WHERE id IN (${ids:csv})", { ids: ["1", "2", "3"] } as Params);
const listModifier = db.many<{ id: string }>("SELECT id FROM users WHERE id IN (${ids:list})", { ids: ["1", "2", "3"] } as Params);

// --- Missing params with modifiers ---

// @expect TS006 "missing"
const missingWithRaw = db.one<{ id: string }>("SELECT id FROM ${missing:raw}", { table: "users" });

// @expect TS006 "missing"
const missingWithShortcut = db.one<{ id: string }>("SELECT ${missing^} FROM users", { column: "id" });

// @expect TS006 "missing"
const missingWithJson = db.one<{ id: number }>("INSERT INTO type_showcase (jsonb_col) VALUES (${missing:json})", { data: {} });
