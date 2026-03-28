// Test fixtures for return type inference: expressions
// Joins, aggregates, casts, aliases
import { db } from "../db";

// --- Aliased columns ---

interface AliasedResult { user_email: string; post_count: number; }
const aliasCorrect = db.one<AliasedResult>("SELECT email as user_email, (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count FROM users u WHERE id = $1", ["123"]);

// @expect TS010 "email"
interface WrongAlias { email: string; }  // Column is aliased to user_email
const aliasWrong = db.one<WrongAlias>("SELECT email as user_email FROM users WHERE id = $1", ["123"]);

// --- Aggregate functions ---

interface CountResult { count: string; }  // COUNT returns bigint -> string
const countCorrect = db.one<CountResult>("SELECT COUNT(*) as count FROM users");

interface SumResult { total: string; }  // SUM returns numeric -> string
const sumCorrect = db.one<SumResult>("SELECT SUM(view_count) as total FROM posts");

interface AvgResult { avg_age: string; }  // AVG returns numeric -> string
const avgCorrect = db.one<AvgResult>("SELECT AVG(age) as avg_age FROM users");

interface MaxResult { max_views: string; }  // MAX preserves type but bigint -> string
const maxCorrect = db.one<MaxResult>("SELECT MAX(view_count) as max_views FROM posts");

interface BoolAggResult { any_active: boolean; all_active: boolean; }
const boolAggCorrect = db.one<BoolAggResult>("SELECT BOOL_OR(is_active) as any_active, BOOL_AND(is_active) as all_active FROM users");

// @expect TS010 "count"
interface WrongCount { count: number; }  // Should be string
const countWrong = db.one<WrongCount>("SELECT COUNT(*) as count FROM users");

// --- CAST expressions ---

interface CastResult { age_text: string; }
const castCorrect = db.one<CastResult>("SELECT CAST(age AS TEXT) as age_text FROM users WHERE id = $1", ["123"]);

interface CastToInt { view_count_int: number; }
const castIntCorrect = db.one<CastToInt>("SELECT view_count::INTEGER as view_count_int FROM posts WHERE id = $1", [1]);

// --- JOIN expressions ---

interface JoinResult { user_email: string; post_title: string; }
const innerJoinCorrect = db.many<JoinResult>("SELECT u.email as user_email, p.title as post_title FROM users u JOIN posts p ON p.author_id = u.id");

interface MultiJoinResult { user_email: string; post_title: string; comment_content: string; }
const multiJoinCorrect = db.many<MultiJoinResult>("SELECT u.email as user_email, p.title as post_title, c.content as comment_content FROM users u JOIN posts p ON p.author_id = u.id JOIN comments c ON c.post_id = p.id");

// --- Subquery expressions ---

interface SubqueryResult { email: string; post_count: number; }
const subqueryCorrect = db.many<SubqueryResult>("SELECT email, (SELECT COUNT(*)::INTEGER FROM posts WHERE author_id = u.id) as post_count FROM users u");

// --- CASE expressions ---

interface CaseResult { status_label: string; }
const caseCorrect = db.many<CaseResult>("SELECT CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END as status_label FROM users");

// CASE with different types (result type is common supertype)
interface CaseNumericResult { priority: number; }
const caseNumericCorrect = db.many<CaseNumericResult>("SELECT CASE WHEN view_count > 1000 THEN 1 WHEN view_count > 100 THEN 2 ELSE 3 END as priority FROM posts");

// --- String operations ---

interface ConcatResult { full_name: string; }
const concatCorrect = db.one<ConcatResult>("SELECT CONCAT(name, ' <', email, '>') as full_name FROM users WHERE id = $1", ["123"]);

// --- Date operations ---

interface DateOpResult { days_since: number; }
const dateOpCorrect = db.one<DateOpResult>("SELECT EXTRACT(DAY FROM NOW() - created_at)::INTEGER as days_since FROM users WHERE id = $1", ["123"]);

// --- Array operations ---

interface ArrayAggResult { all_tags: string[]; }
const arrayAggCorrect = db.one<ArrayAggResult>("SELECT ARRAY_AGG(DISTINCT tag) as all_tags FROM posts, UNNEST(tags) as tag WHERE author_id = $1", ["123"]);
