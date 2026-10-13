-- Store document bytes in Postgres. Railway's disk does not persist uploads.
ALTER TABLE "documents" ADD COLUMN "content" BYTEA;
