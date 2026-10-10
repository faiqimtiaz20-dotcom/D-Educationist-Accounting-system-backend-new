-- Per-university commission rates by course
CREATE TABLE "university_course_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001',
    "university_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "commission_rate" DECIMAL(8,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "university_course_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "university_course_rates_tenant_id_university_id_course_id_key"
  ON "university_course_rates"("tenant_id", "university_id", "course_id");
CREATE INDEX "university_course_rates_tenant_id_idx" ON "university_course_rates"("tenant_id");
CREATE INDEX "university_course_rates_university_id_idx" ON "university_course_rates"("university_id");
CREATE INDEX "university_course_rates_course_id_idx" ON "university_course_rates"("course_id");

ALTER TABLE "university_course_rates" ADD CONSTRAINT "university_course_rates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "university_course_rates" ADD CONSTRAINT "university_course_rates_university_id_fkey"
  FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "university_course_rates" ADD CONSTRAINT "university_course_rates_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
