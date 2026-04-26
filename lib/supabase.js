import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://alcetorurdocopxatego.supabase.co'
const supabaseKey = 'sb_publishable_VbmRpikpm6xr_lUaqo_MgQ_9swmJ_1j'

export const supabase = createClient(supabaseUrl, supabaseKey)