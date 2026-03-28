// Test fixtures for TS002: Unknown table
import { db } from "../db";

// --- Valid ---
const validUsers = db.one<{ id: string }>("SELECT id FROM users");
const validPosts = db.many<{ id: number }>("SELECT id FROM posts");
const validJoin = db.many<{ id: string }>("SELECT u.id FROM users u JOIN posts p ON p.author_id = u.id");

// --- Unknown tables ---
// Note: Type annotations added to avoid TS007 warnings

// @expect TS002 "nonexistent"
const unknownTable = db.one<{ id: string }>("SELECT * FROM nonexistent");

// @expect TS002 "userz"
const singularMistake = db.one<{ id: string }>("SELECT * FROM userz");

// @expect TS002 "Users"
const caseSensitive = db.one<{ id: string }>('SELECT * FROM "Users"');

// @expect TS002 "post"
const typoTable = db.one<{ id: string }>("SELECT * FROM post");

// @expect TS002
const unknownInJoin = db.many<{ id: string }>("SELECT * FROM users u JOIN unknown_table t ON t.id = u.id");
