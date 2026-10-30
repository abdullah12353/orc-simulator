import { createClient } from '@supabase/supabase-js';

// Local defaults point at this repo's Supabase port block; `npm run web:env` writes the anon key.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:55421';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set (run `npm run web:env` for local dev)');

export const supabase = createClient(url, anonKey);
