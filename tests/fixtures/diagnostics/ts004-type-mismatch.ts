// Test fixtures for TS004: Type mismatch in SQL expression
import { db } from "./db";

// --- Valid type usage ---
const validComparison = db.one<{ id: string }>("SELECT id FROM users WHERE age > $1", [25]);
const validStringOp = db.one<{ id: string }>("SELECT id FROM users WHERE email LIKE $1", ["%@example.com"]);

// --- Type mismatches ---

// @expect TS004 "age"
const stringToInt = db.one<{ id: string }>("SELECT id FROM users WHERE age = $1", ["not a number"]);

// @expect TS004 "is_active"
const intToBool = db.one<{ id: string }>("SELECT id FROM users WHERE is_active = $1", [123]);

// @expect TS004 "id"
const intToUuid = db.one<{ id: string }>("SELECT id FROM users WHERE id = $1", [123]);
