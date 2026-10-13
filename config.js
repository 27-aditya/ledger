// Ledger — cloud configuration (Supabase, free tier)
//
// Setup:
//   1. Create a free project at https://supabase.com
//   2. Open the SQL editor and run the contents of supabase-schema.sql
//   3. Go to Project Settings -> API and copy:
//        - "Project URL"            -> supabaseUrl
//        - "anon public" API key    -> supabaseAnonKey
//   4. Paste them below and reload the page.
//
// Leave both values empty ("") to run fully offline using this
// browser's localStorage. Any expense added while unconfigured stays local.
//
// NOTE: the anon key is meant to be public in the browser. Access is
// controlled by the Row Level Security policies in supabase-schema.sql.

window.LEDGER_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  table: "expenses",
};
