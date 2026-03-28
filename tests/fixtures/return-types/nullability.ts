// Test fixtures for return type inference: nullability
// NULL vs NOT NULL handling
import { db } from "../db";

// --- NOT NULL columns ---

// NOT NULL columns should not be nullable in return type
interface CorrectNotNull { email: string; is_active: boolean; }
const notNullCorrect = db.one<CorrectNotNull>("SELECT email, is_active FROM users WHERE id = $1", ["123"]);

// @expect TS010 "email"
interface WrongNotNull { email: string | null; }  // Should not be nullable
const notNullWrong = db.one<WrongNotNull>("SELECT email FROM users WHERE id = $1", ["123"]);

// --- Nullable columns ---

// Nullable columns should be nullable in return type
interface CorrectNullable { name: string | null; updated_at: Date | null; }
const nullableCorrect = db.one<CorrectNullable>("SELECT name, updated_at FROM users WHERE id = $1", ["123"]);

// @expect TS010 "name"
interface WrongNullable { name: string; }  // Should be nullable
const nullableWrong = db.one<WrongNullable>("SELECT name FROM users WHERE id = $1", ["123"]);

// --- Mixed nullability ---

interface CorrectMixed {
    id: string;           // NOT NULL (UUID PRIMARY KEY)
    email: string;        // NOT NULL
    name: string | null;  // nullable
    age: number | null;   // nullable
}
const mixedCorrect = db.one<CorrectMixed>("SELECT id, email, name, age FROM users WHERE id = $1", ["123"]);

// --- Nullable arrays ---

interface CorrectNullableArray { int_array: number[] | null; }
const nullableArrayCorrect = db.one<CorrectNullableArray>("SELECT int_array FROM type_showcase WHERE id = $1", [1]);

// NOT NULL array
interface CorrectNotNullArray { text_array: string[]; }  // DEFAULT '{}' makes it NOT NULL
const notNullArrayCorrect = db.one<CorrectNotNullArray>("SELECT text_array FROM type_showcase WHERE id = $1", [1]);

// --- oneOrNone vs one ---

// oneOrNone should return T | null at row level
interface UserRow { id: string; email: string; }
const oneOrNoneResult = db.oneOrNone<UserRow>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// many/manyOrNone return T[] (empty array if no results)
const manyResult = db.many<UserRow>("SELECT id, email FROM users WHERE is_active = $1", [true]);

// --- Expressions that produce nullable results ---

// LEFT JOIN can produce nulls
interface LeftJoinResult {
    user_id: string;
    post_title: string | null;  // nullable due to LEFT JOIN
}
const leftJoinCorrect = db.many<LeftJoinResult>("SELECT u.id as user_id, p.title as post_title FROM users u LEFT JOIN posts p ON p.author_id = u.id");

// @expect TS010 "post_title"
interface LeftJoinWrong {
    user_id: string;
    post_title: string;  // Should be nullable
}
const leftJoinWrong = db.many<LeftJoinWrong>("SELECT u.id as user_id, p.title as post_title FROM users u LEFT JOIN posts p ON p.author_id = u.id");

// COALESCE removes nullability
interface CoalesceResult { name: string; }  // COALESCE ensures non-null
const coalesceCorrect = db.one<CoalesceResult>("SELECT COALESCE(name, 'Anonymous') as name FROM users WHERE id = $1", ["123"]);
