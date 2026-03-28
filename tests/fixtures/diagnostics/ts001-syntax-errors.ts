// Test fixtures for TS001: SQL syntax errors
import { db } from "./db";

// --- Valid queries (no annotation = expect no diagnostic) ---
const validSelect = db.one<{ id: string }>("SELECT id FROM users");
const validInsert = db.one<{ id: string }>("INSERT INTO users (email) VALUES ($1) RETURNING id", ["test@example.com"]);

// @expect-pass
const validEscapedQuote = db.one<{ x: string }>("SELECT 'it''s valid' as x");

// --- Invalid queries ---

// @expect TS001
const typoSelect = db.one("SELEC * FROM users");

// @expect TS001
const typoFrom = db.one("SELECT * FORM users");

// @expect TS001
const missingFrom = db.one("SELECT * users");

// @expect TS001
const unclosedQuote = db.one("SELECT 'unclosed FROM users");

// @expect-pass (this is valid SQL: "SELECT id AS name FROM users")
const implicitAlias = db.one<{ name: string }>("SELECT id name FROM users");

// @expect TS001
const doubleFrom = db.one("SELECT * FROM FROM users");

// @expect TS001
const trailingComma = db.one("SELECT id, FROM users");

// Empty and whitespace queries - pg_parse returns empty parse tree instead of error
// TODO: ts-sqlx should detect and report these as TS001
// @expect TS007 (untyped query - syntax detection not yet implemented)
const emptyQuery = db.one("");

// @expect TS007 (untyped query - syntax detection not yet implemented)
const whitespaceOnly = db.one("   ");
