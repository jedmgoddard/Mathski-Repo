// /api/mark.js
// Proxies requests to Anthropic API, with auth gate enforcement
// Option C: 1 free mark (tracked by email in free_trials), then payment required

import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FREE_MARKS_ALLOWED = 1;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Free-Email');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Free-Email');

  const authHeader = req.headers.authorization;
  const freeEmail = req.headers['x-free-email']?.toLowerCase();

  let markAuthorised = false;
  let isFreeTrial = false;
  let authedEmail = null;

  // ── 1. Check authenticated user ───────────────────────────────────────────
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (!error && user) {
      authedEmail = user.email.toLowerCase();
      const { data: dbUser } = await supabase
        .from('users')
        .select('tier, marks_used, marks_limit, expires_at')
        .eq('email', authedEmail)
        .single();

      if (dbUser) {
        if (dbUser.tier === 'teacher') {
          // Check expiry
          if (!dbUser.expires_at || new Date(dbUser.expires_at) > new Date()) {
            markAuthorised = true;
          } else {
            return res.status(403).json({ error: 'Subscription expired', code: 'EXPIRED' });
          }
        } else if (dbUser.tier === 'student') {
          if (dbUser.marks_limit === -1 || dbUser.marks_used < dbUser.marks_limit) {
            markAuthorised = true;
          } else {
            return res.status(403).json({ error: 'No marks remaining', code: 'NO_MARKS' });
          }
        }
      }
    }
  }

  // ── 2. Check free trial (by email, no account) ────────────────────────────
  if (!markAuthorised && freeEmail) {
    const { data: trial } = await supabase
      .from('free_trials')
      .select('marks_used')
      .eq('email', freeEmail)
      .single();

    const used = trial?.marks_used ?? 0;

    if (used < FREE_MARKS_ALLOWED) {
      markAuthorised = true;
      isFreeTrial = true;
      authedEmail = freeEmail;
    } else {
      return res.status(403).json({ error: 'Free trial used', code: 'TRIAL_USED' });
    }
  }

  // ── 3. No auth, no email → gate ───────────────────────────────────────────
  if (!markAuthorised) {
    return res.status(401).json({ error: 'Sign in required', code: 'AUTH_REQUIRED' });
  }

  // ── 4. Forward to Anthropic ───────────────────────────────────────────────
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // ── 5. Record mark usage ───────────────────────────────────────────────
    const tokensUsed = data.usage?.input_tokens + data.usage?.output_tokens;

    if (isFreeTrial && authedEmail) {
      // Upsert free trial record
      await supabase.from('free_trials').upsert({
        email: authedEmail,
        marks_used: 1,
        last_used_at: new Date().toISOString(),
      }, { onConflict: 'email' });
    } else if (authedEmail) {
      // Increment marks_used for paid user
      await supabase.rpc('increment_marks_used', { user_email: authedEmail });

      // Log session
      await supabase.from('mark_sessions').insert({
        email: authedEmail,
        tokens_used: tokensUsed,
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
}
