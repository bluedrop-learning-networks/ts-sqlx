// Test fixtures for parameter type validation
// Correct types, mismatches, nullable, arrays
import { db } from "./db";

// --- Correct parameter types ---

// String params
const stringParam = db.one<{ id: string }>("SELECT id FROM users WHERE email = $1", ["test@example.com"]);
const uuidParam = db.one<{ id: string }>("SELECT id FROM users WHERE id = $1", ["550e8400-e29b-41d4-a716-446655440000"]);

// Numeric params
const intParam = db.one<{ id: string }>("SELECT id FROM users WHERE age = $1", [25]);
const bigintParam = db.one<{ id: number }>("SELECT id FROM posts WHERE view_count > $1", [1000000]);
const floatParam = db.one<{ id: number }>("SELECT id FROM type_showcase WHERE real_num = $1", [3.14]);

// Boolean params
const boolParam = db.one<{ id: string }>("SELECT id FROM users WHERE is_active = $1", [true]);

// Date/time params
const dateParam = db.one<{ id: string }>("SELECT id FROM users WHERE created_at > $1", [new Date()]);
const timestampParam = db.one<{ id: number }>("SELECT id FROM type_showcase WHERE timestamptz_col < $1", [new Date()]);

// Array params
const textArrayParam = db.one<{ id: number }>("SELECT id FROM posts WHERE tags = $1", [["tag1", "tag2"]]);
const intArrayParam = db.one<{ id: number }>("SELECT id FROM type_showcase WHERE int_array = $1", [[1, 2, 3]]);

// JSON params
const jsonParam = db.one<{ id: number }>("SELECT id FROM type_showcase WHERE jsonb_col = $1", [{ key: "value" }]);

// Null params (for nullable columns)
const nullParam = db.one<{ id: string }>("SELECT id FROM users WHERE name = $1", [null]);

// --- Type mismatches ---

// @expect TS004 "age"
const stringForInt = db.one<{ id: string }>("SELECT id FROM users WHERE age = $1", ["not a number"]);

// @expect TS004 "is_active"
const intForBool = db.one<{ id: string }>("SELECT id FROM users WHERE is_active = $1", [1]);

// @expect TS004 "id"
const numberForUuid = db.one<{ id: string }>("SELECT id FROM users WHERE id = $1", [12345]);

// @expect TS004 "created_at"
const stringForTimestamp = db.one<{ id: string }>("SELECT id FROM users WHERE created_at = $1", ["not a date"]);

// @expect TS004 "int_array"
const stringForIntArray = db.one<{ id: number }>("SELECT id FROM type_showcase WHERE int_array = $1", [["a", "b"]]);
