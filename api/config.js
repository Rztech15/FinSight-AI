// GET /api/config — public runtime configuration for the browser.
// Only values that are safe to expose are returned: the Supabase URL and ANON key are public by design
// (Row Level Security protects the data). Server secrets (AI_API_KEY, service-role keys) are never read here.

export function buildConfig(env = process.env) {
  const supabase = env.SUPABASE_URL && env.SUPABASE_ANON_KEY
    ? { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY } : null;
  return {
    aiConfigured: !!(env.AI_PROVIDER && env.AI_MODEL && env.AI_API_KEY),
    authRequired: env.REQUIRE_AUTH === 'true',
    supabase,
    mode: 'sandbox',
  };
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(buildConfig());
}
