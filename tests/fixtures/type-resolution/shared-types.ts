// Shared type definitions used by other type-resolution fixtures
// This file contains type/interface definitions that are imported elsewhere

// Basic interfaces
export interface User {
    id: string;
    email: string;
    name: string | null;
}

export interface Post {
    id: number;
    author_id: string;
    title: string;
    body: string | null;
}

export interface Comment {
    id: number;
    post_id: number;
    user_id: string;
    content: string;
}

// Type aliases
export type UserId = string;
export type PostId = number;

// Nested types
export interface UserWithPosts {
    user: User;
    posts: Post[];
}

// Partial types
export type UserSummary = Pick<User, 'id' | 'email'>;
export type PostPreview = Omit<Post, 'body'>;

// Union types
export type EntityId = UserId | PostId;

// Intersection types
export interface Timestamped {
    created_at: Date;
    updated_at: Date | null;
}
export type UserWithTimestamps = User & Timestamped;
