// Test fixtures for TS010: Declared type doesn't match inferred type
import { db } from "./db";

// --- Matching types ---
interface CorrectUser { id: string; email: string; }
const matchingType = db.one<CorrectUser>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// --- Mismatched types ---

interface WrongColumnName { userId: string; email: string; }  // Should be 'id'
// @expect TS010 "id"
const wrongPropertyName = db.one<WrongColumnName>("SELECT id, email FROM users WHERE id = $1", ["123"]);

interface MissingColumn { id: string; }  // missing email
// @expect TS010 "email"
const missingProperty = db.one<MissingColumn>("SELECT id, email FROM users WHERE id = $1", ["123"]);

interface ExtraColumn { id: string; email: string; extra: string; }
// @expect TS010 "extra"
const extraProperty = db.one<ExtraColumn>("SELECT id, email FROM users WHERE id = $1", ["123"]);

interface WrongType { id: number; email: string; }  // id should be string (UUID)
// @expect TS010 "id"
const wrongPropertyType = db.one<WrongType>("SELECT id, email FROM users WHERE id = $1", ["123"]);
