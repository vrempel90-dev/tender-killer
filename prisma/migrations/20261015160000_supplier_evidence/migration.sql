ALTER TABLE "supplier_quotes" ADD COLUMN "supplierChargesVat" BOOLEAN;
ALTER TABLE "supplier_quotes" ADD COLUMN "valuesConfirmed" BOOLEAN NOT NULL DEFAULT false;
