// /api/auth.js
// Check endpoint: verifies JWT from Supabase session and returns user record
// Called by frontend before every mark attempt

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }

  const token = authHeader.slice(7);

  // Verify the JWT with Supabase
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const email = user.email.toLowerCase();

  // Look up our users table
  const { data: dbUser, error: dbError } = await supabase
    .from('users')
    .select('email, role, tier, marks_used, marks_limit, expires_at')
    .eq('email', email)
    .single();

  if (dbError || !dbUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Check teacher subscription expiry
  if (dbUser.tier === 'teacher' && dbUser.expires_at) {
    if (new Date(dbUser.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Subscription expired', tier: 'teacher', expired: true });
    }
  }

  // Check student mark allowance
  if (dbUser.tier === 'student') {
    const remaining = dbUser.marks_limit - dbUser.marks_used;
    if (remaining <= 0) {
      return res.status(403).json({ error: 'No marks remaining', tier: 'student', remaining: 0 });
    }
    return res.status(200).json({
      ok: true,
      email: dbUser.email,
      tier: dbUser.tier,
      role: dbUser.role,
      remaining,
      marksUsed: dbUser.marks_used,
      marksLimit: dbUser.marks_limit,
    });
  }

  // Teacher with valid subscription
  return res.status(200).json({
    ok: true,
    email: dbUser.email,
    tier: dbUser.tier,
    role: dbUser.role,
    remaining: -1, // unlimited
    expiresAt: dbUser.expires_at,
  });
}
