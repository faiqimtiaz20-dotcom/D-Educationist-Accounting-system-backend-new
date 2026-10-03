-- Tenant-wise SMTP / OAuth email config (MT email)

CREATE TYPE "SmtpProvider" AS ENUM ('GMAIL', 'MICROSOFT365', 'OUTLOOK', 'CUSTOM');
CREATE TYPE "SmtpAuthMode" AS ENUM ('PASSWORD', 'OAUTH');

CREATE TABLE "tenant_smtp_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "SmtpProvider" NOT NULL DEFAULT 'CUSTOM',
    "auth_mode" "SmtpAuthMode" NOT NULL DEFAULT 'PASSWORD',
    "from_email" VARCHAR(200),
    "from_name" VARCHAR(160),
    "host" VARCHAR(200),
    "port" INTEGER,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" VARCHAR(200),
    "password_enc" TEXT,
    "oauth_access_token_enc" TEXT,
    "oauth_refresh_token_enc" TEXT,
    "oauth_expires_at" TIMESTAMP(3),
    "oauth_email" VARCHAR(200),
    "connected_at" TIMESTAMP(3),
    "last_test_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_smtp_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_smtp_configs_tenant_id_key" ON "tenant_smtp_configs"("tenant_id");

ALTER TABLE "tenant_smtp_configs"
  ADD CONSTRAINT "tenant_smtp_configs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
