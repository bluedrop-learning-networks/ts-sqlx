// Test fixtures for TS005: Wrong parameter count
import { db } from "./db";

// --- Correct counts ---
const noParams = db.one<{ id: string }>("SELECT id FROM users LIMIT 1");
const oneParam = db.one<{ id: string }>("SELECT id FROM users WHERE id = $1", ["123"]);
const twoParams = db.one<{ id: string }>("SELECT id FROM users WHERE id = $1 AND email = $2", ["123", "test@example.com"]);

// --- Wrong counts ---

// @expect TS005 "expected 1"
const missingParam = db.one("SELECT id FROM users WHERE id = $1");

// @expect TS005 "expected 2"
const missingSecond = db.one("SELECT id FROM users WHERE id = $1 AND email = $2", ["123"]);

// @expect TS005 "expected 1"
const tooMany = db.one("SELECT id FROM users WHERE id = $1", ["123", "extra", "params"]);

// @expect TS005
const emptyArrayNeeded = db.one("SELECT id FROM users WHERE id = $1", []);
