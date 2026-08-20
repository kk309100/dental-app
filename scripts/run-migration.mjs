import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env.local', 'utf8')
const serviceKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()
const supabaseUrl = 'https://alcetorurdocopxatego.supabase.co'

const supabase = createClient(supabaseUrl, serviceKey)

const sqls = [
  `ALTER TABLE clinic_inventory_items ADD COLUMN IF NOT EXISTS units_per_package integer`,
  `CREATE TABLE IF NOT EXISTS inventory_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE (clinic_id, name)
  )`,
]

for (const sql of sqls) {
  const { error } = await supabase.rpc('exec_sql', { sql }).single()
  if (error && !error.message?.includes('already exists')) {
    console.error('Error:', error.message, '\nSQL:', sql.slice(0, 60))
  } else {
    console.log('OK:', sql.slice(0, 60))
  }
}
