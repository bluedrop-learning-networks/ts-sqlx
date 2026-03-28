// Test fixtures for TS009: No database connection
// This file is tested with database connection disabled
import { db } from "./db";

// When no database connection, queries that need schema info emit TS009
// Syntax errors (TS001) can still be detected without connection

// @expect TS009
const needsSchema = db.one<{ id: string }>("SELECT id FROM users");

// @expect TS001
const syntaxErrorStillWorks = db.one("SELEC * FROM users");

// @expect TS009
const insertNeedsSchema = db.one("INSERT INTO users (email) VALUES ($1) RETURNING id", ["test@example.com"]);
