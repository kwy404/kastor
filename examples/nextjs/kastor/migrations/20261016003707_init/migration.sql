-- Migration 20261016003707_init
-- Written by kastor 0.1.1 for sqlite on 2026-10-16 00:37:07 UTC.
-- Applied by `kastor migrate deploy`. Edit it before it is applied if you need to;
-- after that, the checksum in _kastor_migrations must keep matching.
--
-- Changes:
--   + Create table authors
--   + Create table posts

-- Create table authors
CREATE TABLE "authors" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" VARCHAR(100) NOT NULL,
  "email" VARCHAR(255) NOT NULL
);
CREATE UNIQUE INDEX "authors_email_key" ON "authors" ("email");

-- Create table posts
CREATE TABLE "posts" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title" VARCHAR(200) NOT NULL,
  "body" TEXT,
  "authorId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "authors" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "posts_authorId_idx" ON "posts" ("authorId");
