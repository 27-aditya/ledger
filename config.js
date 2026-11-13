// Supabase connection for Ledger.
//
// Project Settings → API:
//   url     = Project URL, e.g. "https://abcdefgh.supabase.co"
//   anonKey = the "anon public" / publishable key
//
// Both values are public by design. Your data is protected by the ledger key
// (set in supabase-schema.sql), not by these. Leave them empty to run local-only.
window.LEDGER_SUPABASE = {
  url: "https://vkteqazmhzbkjrzocxnj.supabase.co/rest/v1/",
  anonKey: "sb_publishable_2VrHOu1rc-gRkQcjTZ7PAg_Q2p4w-AO",
};
