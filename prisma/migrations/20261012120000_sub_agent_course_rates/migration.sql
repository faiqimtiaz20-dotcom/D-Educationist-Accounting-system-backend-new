-- Per-sub-agent commission rates by course
CREATE TABLE "sub_agent_course_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001',
    "sub_agent_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "commission_rate" DECIMAL(8,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_agent_course_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sub_agent_course_rates_tenant_id_sub_agent_id_course_id_key"
  ON "sub_agent_course_rates"("tenant_id", "sub_agent_id", "course_id");
CREATE INDEX "sub_agent_course_rates_tenant_id_idx" ON "sub_agent_course_rates"("tenant_id");
CREATE INDEX "sub_agent_course_rates_sub_agent_id_idx" ON "sub_agent_course_rates"("sub_agent_id");
CREATE INDEX "sub_agent_course_rates_course_id_idx" ON "sub_agent_course_rates"("course_id");

ALTER TABLE "sub_agent_course_rates" ADD CONSTRAINT "sub_agent_course_rates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_agent_course_rates" ADD CONSTRAINT "sub_agent_course_rates_sub_agent_id_fkey"
  FOREIGN KEY ("sub_agent_id") REFERENCES "sub_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_agent_course_rates" ADD CONSTRAINT "sub_agent_course_rates_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
