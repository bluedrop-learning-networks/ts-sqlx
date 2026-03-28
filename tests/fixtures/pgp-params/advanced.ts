// Test fixtures for pg-promise advanced parameter syntax
// Nested properties, this keyword, indexed parameters with modifiers
import { db } from "../db";

interface User { id: string; profile: { name: string; email: string; }; }
interface Context { userId: string; filters: { status: string; date: string; }; }

// --- Nested properties ---
const nestedProp = db.one<{ id: string }>("SELECT id FROM users WHERE name = ${profile.name}", { profile: { name: "test", email: "test@example.com" } } as User);
const deepNested = db.one<{ id: string }>("SELECT id FROM users WHERE status = ${filters.status}", { userId: "123", filters: { status: "active", date: "2024-01-01" } } as Context);

// @expect TS006 "profile.missing"
const missingNestedProp = db.one<{ id: string }>("SELECT id FROM users WHERE name = ${profile.missing}", { profile: { name: "test" } });

// --- this keyword ---
const thisKeyword = db.one<{ id: string }>("SELECT id FROM users WHERE data = ${this}", { key: "value" });

// --- Indexed parameters with modifiers ---
const indexedWithName = db.one<{ id: string }>("SELECT id FROM $1:name WHERE id = $2", ["users", "123"]);
const indexedWithRaw = db.one<{ id: string }>("SELECT id FROM $1:raw WHERE id = $2", ["users", "123"]);
const indexedShortcuts = db.one<{ id: string }>("SELECT $1# FROM $2^ WHERE id = $3", ["id", "users", "123"]);

// --- Combined indexed and named ---
const mixedIndexedNamed = db.one<{ id: string }>("SELECT id FROM users WHERE id = $1 AND name = ${name}", ["123", { name: "test" }]);

// --- Edge cases ---

// @expect TS001
const emptyParam = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${}", { id: "123" });

// @expect TS001
const unclosedBracket = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id", { id: "123" });
