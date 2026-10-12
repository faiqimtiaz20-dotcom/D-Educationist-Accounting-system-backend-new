-- Agent commission on university master (USP + Agent, like commission sheet)
ALTER TABLE "universities"
  ADD COLUMN IF NOT EXISTS "default_agent_commission_rate" DECIMAL(8,4) NOT NULL DEFAULT 0;

ALTER TABLE "university_course_rates"
  ADD COLUMN IF NOT EXISTS "agent_commission_rate" DECIMAL(8,4) NOT NULL DEFAULT 0;
