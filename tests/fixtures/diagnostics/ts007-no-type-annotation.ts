// Test fixtures for TS007: No type annotation (warning)
import { db } from "./db";

interface User { id: string; email: string; }

// --- Typed queries (no warning) ---
const typedOne = db.one<User>("SELECT id, email FROM users WHERE id = $1", ["123"]);
const typedMany = db.many<User>("SELECT id, email FROM users");

// --- Untyped queries (TS007 warning) ---

// @expect TS007
// @action "Generate type" -> "<{ id: string; email: string }>"
const untypedOne = db.one("SELECT id, email FROM users WHERE id = $1", ["123"]);

// @expect TS007
// @action "Generate type" -> "<{ id: string; email: string }>"
const untypedMany = db.many("SELECT id, email FROM users");

// @expect TS007
const untypedWithParams = db.one("SELECT id FROM users WHERE email = $1", ["test@example.com"]);
