-- Enable case-insensitive email type used by Prisma @db.Citext
-- Run automatically as part of the initial migration, or manually:
--   psql $DATABASE_URL -f prisma/sql/000_extensions.sql

CREATE EXTENSION IF NOT EXISTS citext;
