-- MT2: platform CRM users may have null branch_id (tenant_id already nullable from MT1)

ALTER TABLE "users" ALTER COLUMN "branch_id" DROP NOT NULL;
