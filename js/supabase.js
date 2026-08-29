/**
 * OSA — Supabase Client
 * Centralized Supabase initialization
 */

let _supabaseClient = null;

function getSupabase() {
  if (_supabaseClient) return _supabaseClient;

  if (!OSA_CONFIG.SUPABASE_URL || !OSA_CONFIG.SUPABASE_ANON_KEY) {
    console.error('[OSA] Supabase URL e ANON KEY não configurados. Edite js/config.js');
    return null;
  }

  _supabaseClient = window.supabase.createClient(
    OSA_CONFIG.SUPABASE_URL,
    OSA_CONFIG.SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    }
  );

  return _supabaseClient;
}
