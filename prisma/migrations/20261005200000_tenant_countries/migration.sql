-- Per-tenant destination countries (Settings master)
CREATE TABLE IF NOT EXISTS "tenant_countries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001',
  "name" VARCHAR(80) NOT NULL,
  "iso_code" VARCHAR(2),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "tenant_countries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_countries_tenant_id_name_key"
  ON "tenant_countries" ("tenant_id", "name");

CREATE INDEX IF NOT EXISTS "tenant_countries_tenant_id_idx"
  ON "tenant_countries" ("tenant_id");

ALTER TABLE "tenant_countries"
  DROP CONSTRAINT IF EXISTS "tenant_countries_tenant_id_fkey";
ALTER TABLE "tenant_countries"
  ADD CONSTRAINT "tenant_countries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed defaults + backfill from existing university country names
INSERT INTO "tenant_countries" ("id", "tenant_id", "name", "iso_code", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), t.id, d.name, d.iso, true, NOW(), NOW()
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('UK', 'GB'),
    ('USA', 'US'),
    ('Canada', 'CA'),
    ('Australia', 'AU'),
    ('Germany', 'DE'),
    ('Ireland', 'IE'),
    ('New Zealand', 'NZ')
) AS d(name, iso)
WHERE t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "tenant_countries" tc
    WHERE tc.tenant_id = t.id AND tc.name = d.name AND tc.deleted_at IS NULL
  );

INSERT INTO "tenant_countries" ("id", "tenant_id", "name", "iso_code", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), u.tenant_id, u.country_name, NULL, true, NOW(), NOW()
FROM (
  SELECT DISTINCT tenant_id, country_name
  FROM "universities"
  WHERE deleted_at IS NULL AND country_name IS NOT NULL AND trim(country_name) <> ''
) u
WHERE NOT EXISTS (
  SELECT 1 FROM "tenant_countries" tc
  WHERE tc.tenant_id = u.tenant_id
    AND lower(tc.name) = lower(u.country_name)
    AND tc.deleted_at IS NULL
);
