-- Human-readable sub-agent number (like invoice_no / expense_no)

ALTER TABLE "sub_agents" ADD COLUMN IF NOT EXISTS "sub_agent_no" VARCHAR(40);

WITH numbered AS (
  SELECT
    id,
    'SA-' || lpad(
      row_number() OVER (PARTITION BY tenant_id ORDER BY created_at ASC, name ASC)::text,
      3,
      '0'
    ) AS new_no
  FROM "sub_agents"
  WHERE "sub_agent_no" IS NULL OR "sub_agent_no" = ''
)
UPDATE "sub_agents" s
SET "sub_agent_no" = n.new_no
FROM numbered n
WHERE s.id = n.id;

ALTER TABLE "sub_agents" ALTER COLUMN "sub_agent_no" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "sub_agents_tenant_id_sub_agent_no_key"
  ON "sub_agents"("tenant_id", "sub_agent_no");
