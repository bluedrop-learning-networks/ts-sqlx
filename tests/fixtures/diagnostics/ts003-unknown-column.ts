// Test fixtures for TS003: Unknown column
import { db } from "./db";

// --- Valid ---
const validColumns = db.one<{ id: string; email: string }>("SELECT id, email FROM users");
const validStar = db.one("SELECT * FROM users WHERE id = $1", ["123"]);

// --- Unknown columns ---

// @expect TS003 "nonexistent"
const unknownColumn = db.one("SELECT nonexistent FROM users");

// @expect TS003 "emial"
const typoColumn = db.one("SELECT emial FROM users");

// @expect TS003 @expect TS003
const multipleUnknown = db.one("SELECT bad1, bad2 FROM users");

// @expect TS003 "ID"
const caseSensitiveCol = db.one('SELECT "ID" FROM users');

// @expect TS003
const unknownInWhere = db.one("SELECT id FROM users WHERE unknown_col = $1", ["value"]);

// @expect TS003
const unknownInJoin = db.many("SELECT u.id FROM users u JOIN posts p ON p.bad_column = u.id");
