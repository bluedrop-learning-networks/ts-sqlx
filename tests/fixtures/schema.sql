-- Test database schema for ts-sqlx integration tests
-- Covers all PostgreSQL types and relationships

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    age INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    author_id UUID NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT,
    view_count BIGINT NOT NULL DEFAULT 0,
    published_at TIMESTAMPTZ,
    tags TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    user_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE status_enum AS ENUM ('draft', 'published', 'archived');
CREATE TYPE address AS (street TEXT, city TEXT, zip TEXT);

CREATE TABLE type_showcase (
    id SERIAL PRIMARY KEY,
    -- Numeric
    small_int SMALLINT,
    regular_int INTEGER NOT NULL,
    big_int BIGINT,
    real_num REAL,
    double_num DOUBLE PRECISION,
    numeric_val NUMERIC(10, 2),
    -- Text
    char_col CHAR(10),
    varchar_col VARCHAR(255),
    text_col TEXT NOT NULL,
    -- Binary
    bytes BYTEA,
    -- Date/Time
    date_col DATE,
    time_col TIME,
    timetz_col TIMETZ,
    timestamp_col TIMESTAMP,
    timestamptz_col TIMESTAMPTZ NOT NULL DEFAULT now(),
    interval_col INTERVAL,
    -- Boolean
    bool_col BOOLEAN NOT NULL,
    -- UUID
    uuid_col UUID,
    -- JSON
    json_col JSON,
    jsonb_col JSONB NOT NULL DEFAULT '{}',
    -- Arrays
    int_array INTEGER[],
    text_array TEXT[] NOT NULL DEFAULT '{}',
    -- Enum & Composite
    status status_enum NOT NULL DEFAULT 'draft',
    address address,
    -- Network
    inet_col INET,
    cidr_col CIDR,
    macaddr_col MACADDR,
    -- Full-text search
    search_vector TSVECTOR
);

CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    status status_enum NOT NULL DEFAULT 'draft',
    total NUMERIC(10, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL
);
