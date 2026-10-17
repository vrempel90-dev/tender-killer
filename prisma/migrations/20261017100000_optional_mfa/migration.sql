-- Default-only change. Existing company rows and user credentials are preserved.
ALTER TABLE "companies" ALTER COLUMN "requireMfaForAdmins" SET DEFAULT false;
