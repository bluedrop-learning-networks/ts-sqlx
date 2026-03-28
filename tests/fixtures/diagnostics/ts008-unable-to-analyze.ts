// Test fixtures for TS008: Unable to analyze query
import { db } from "./db";
declare const getTableName: () => string;
declare const userId: string;
declare const tableName: string;
declare const query: string;
declare const condition: boolean;

// --- Analyzable queries ---
const staticQuery = db.one<{ id: string }>("SELECT id FROM users LIMIT 1");

// --- Unanalyzable queries ---

// @expect TS008
const dynamicTable = db.one(`SELECT * FROM ${getTableName()}`);

// @expect TS008
const templateLiteral = db.one(`SELECT * FROM users WHERE id = '${userId}'`);

// @expect TS008
const concatenatedQuery = db.one("SELECT * FROM " + tableName);

// @expect TS008
const variableQuery = db.one(query);

// @expect TS008
const conditionalQuery = db.one(condition ? "SELECT id FROM users" : "SELECT id FROM posts");
