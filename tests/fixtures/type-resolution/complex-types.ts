// Test fixtures for complex TypeScript types
// NOTE: Complex types like generics, mapped types, and utility types require
// advanced parsing that is not yet fully implemented.
// This fixture tests what currently works.

import { db } from "../db";

// === TESTS THAT WORK: Simple type aliases and interfaces ===

// Simple type alias (expands to object literal)
type SimpleUser = { id: string; email: string; };
const simpleAlias = db.one<SimpleUser>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// Simple interface
interface SimpleInterface { id: string; email: string; }
const simpleInterface = db.one<SimpleInterface>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// Type mismatch with simple types
interface TooFewFields { id: string; }
// @expect TS010 "email"
const tooFewFields = db.one<TooFewFields>("SELECT id, email FROM users WHERE id = $1", ["123"]);

interface TooManyFields { id: string; email: string; extra: number; }
// @expect TS010 "extra"
const tooManyFields = db.one<TooManyFields>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// === TESTS FOR UNION TYPES (should work with source resolution) ===

// Type with nullable field using union
interface NullableField { id: string; name: string | null; }
const nullableField = db.one<NullableField>("SELECT id, name FROM users WHERE id = $1", ["123"]);

// === TESTS FOR INTERSECTION TYPES (limited support) ===
// Note: Intersection types require parsing A & B and merging properties.
// Currently resolved via source-based parsing.

interface BaseEntity { id: string; }
interface WithEmail { email: string; }
type UserEntity = BaseEntity & WithEmail;

// This should work if intersection parsing merges the properties correctly
const intersectionCorrect = db.one<UserEntity>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// === COMPLEX TYPES (not yet supported) ===
// These require advanced type evaluation that is not implemented yet:
// - Mapped types: Readonly<T>, Partial<T>, Required<T>
// - Utility types: Pick<T, K>, Omit<T, K>
// - Conditional types: NonNullable<T>
// - Generic type parameters in queries

// Example of what we'd like to support in the future:
// type PickedUser = Pick<FullUser, 'id' | 'email'>;
// const pickedType = db.one<PickedUser>("SELECT id, email FROM users WHERE id = $1", ["123"]);
