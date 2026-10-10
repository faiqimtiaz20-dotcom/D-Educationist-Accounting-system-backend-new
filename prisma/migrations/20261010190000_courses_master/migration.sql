-- Courses master (tenant-scoped) + students.course → course_id

CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001',
    "name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courses_tenant_id_name_key" ON "courses"("tenant_id", "name");
CREATE INDEX "courses_tenant_id_idx" ON "courses"("tenant_id");

ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed courses from distinct existing student.course values
INSERT INTO "courses" ("id", "tenant_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."tenant_id", trim(s."course"), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "tenant_id", trim("course") AS "course"
  FROM "students"
  WHERE trim("course") <> ''
) s;

-- Fallback course for empty/missing names
INSERT INTO "courses" ("id", "tenant_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), t."id", 'Unspecified', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "courses" c
  WHERE c."tenant_id" = t."id" AND c."name" = 'Unspecified' AND c."deleted_at" IS NULL
);

ALTER TABLE "students" ADD COLUMN "course_id" UUID;

UPDATE "students" st
SET "course_id" = c."id"
FROM "courses" c
WHERE c."tenant_id" = st."tenant_id"
  AND c."name" = trim(st."course")
  AND trim(st."course") <> '';

UPDATE "students" st
SET "course_id" = c."id"
FROM "courses" c
WHERE st."course_id" IS NULL
  AND c."tenant_id" = st."tenant_id"
  AND c."name" = 'Unspecified';

ALTER TABLE "students" ALTER COLUMN "course_id" SET NOT NULL;

ALTER TABLE "students" ADD CONSTRAINT "students_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "students_course_id_idx" ON "students"("course_id");

ALTER TABLE "students" DROP COLUMN "course";
