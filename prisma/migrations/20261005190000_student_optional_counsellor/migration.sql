-- Allow students without an assigned consultant
ALTER TABLE "students" ALTER COLUMN "counsellor_id" DROP NOT NULL;
