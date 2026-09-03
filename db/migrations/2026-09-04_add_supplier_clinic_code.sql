-- 仕入先コード・得意先（医院）コードで検索できるようにする
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code text;
ALTER TABLE clinics   ADD COLUMN IF NOT EXISTS clinic_code   text;

CREATE INDEX IF NOT EXISTS idx_suppliers_supplier_code ON suppliers(supplier_code);
CREATE INDEX IF NOT EXISTS idx_clinics_clinic_code ON clinics(clinic_code);

NOTIFY pgrst, 'reload schema';
