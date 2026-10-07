const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // Verify Lemon Squeezy webhook signature
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const signature = req.headers['x-signature'];

  if (secret && signature) {
    const rawBody = JSON.stringify(req.body);
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (hmac !== signature) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = req.body;
  const eventName = event?.meta?.event_name;

  // Only handle order_created
  if (eventName !== 'order_created') {
    return res.status(200).json({ received: true });
  }

  const order = event?.data?.attributes;
  const email = order?.user_email?.toLowerCase();
  const variantId = String(order?.first_order_item?.variant_id || '');
  const status = order?.status;

  // Only process paid orders
  if (status !== 'paid') {
    return res.status(200).json({ received: true });
  }

  const STUDENT_VARIANT_ID = process.env.LEMON_STUDENT_VARIANT_ID || 'STUDENT_VARIANT_PLACEHOLDER';
  const TEACHER_VARIANT_ID = process.env.LEMON_TEACHER_VARIANT_ID || 'TEACHER_VARIANT_PLACEHOLDER';

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    if (variantId === STUDENT_VARIANT_ID) {
      // Add 1 student credit
      const { data: existing } = await supabase
        .from('credits')
        .select('credits_remaining')
        .eq('email', email)
        .single();

      if (existing) {
        await supabase
          .from('credits')
          .update({
            credits_remaining: existing.credits_remaining + 1,
            updated_at: new Date().toISOString()
          })
          .eq('email', email);
      } else {
        await supabase
          .from('credits')
          .insert({
            email,
            credits_remaining: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
      }

      // Send confirmation email via Resend
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Mathski <reports@mathski.io>',
          to: [email],
          subject: 'Your Mathski report credit is ready',
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2f2f7;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:500px;margin:0 auto;padding:24px 16px;">
    <div style="background:#007aff;border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
      <div style="font-size:24px;font-weight:800;color:white;">Mathski</div>
      <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">IB Mathematics IA and Revision Tool</div>
    </div>
    <div style="background:white;padding:28px;border:1px solid #e5e5ea;border-top:none;">
      <div style="font-size:20px;font-weight:800;color:#1c1c1e;margin-bottom:12px;">Your report credit is ready ✓</div>
      <div style="font-size:15px;color:#3c3c43;line-height:1.6;margin-bottom:20px;">
        You have 1 IA report credit. Head to Mathski, upload your IA, and enter <strong>${email}</strong> when prompted to use your credit.
      </div>
      <a href="https://mathski.io" style="display:inline-block;background:#007aff;color:white;text-decoration:none;padding:12px 28px;border-radius:9999px;font-weight:700;font-size:15px;">Go to Mathski →</a>
    </div>
    <div style="background:#f2f2f7;border-radius:0 0 16px 16px;padding:14px 28px;text-align:center;border:1px solid #e5e5ea;border-top:none;">
      <div style="font-size:11px;color:#aeaeb2;">© 2026 Mathski. All rights reserved.</div>
    </div>
  </div>
</body>
</html>`
        })
      });

    } else if (variantId === TEACHER_VARIANT_ID) {
      // Grant teacher access — upsert into users table
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

      if (existingUser) {
        await supabase
          .from('users')
          .update({
            is_teacher: true,
            teacher_since: new Date().toISOString(),
            teacher_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          })
          .eq('email', email);
      } else {
        await supabase
          .from('users')
          .insert({
            email,
            is_teacher: true,
            teacher_since: new Date().toISOString(),
            teacher_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          });
      }

      // Send teacher welcome email
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Mathski <reports@mathski.io>',
          to: [email],
          subject: 'Welcome to Mathski Teacher Access',
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2f2f7;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:500px;margin:0 auto;padding:24px 16px;">
    <div style="background:#007aff;border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
      <div style="font-size:24px;font-weight:800;color:white;">Mathski</div>
      <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">IB Mathematics IA and Revision Tool</div>
    </div>
    <div style="background:white;padding:28px;border:1px solid #e5e5ea;border-top:none;">
      <div style="font-size:20px;font-weight:800;color:#1c1c1e;margin-bottom:12px;">Teacher access activated ✓</div>
      <div style="font-size:15px;color:#3c3c43;line-height:1.6;margin-bottom:20px;">
        Your teacher account is live. Log in with your magic link at Mathski to mark IAs with full criterion justifications, coversheet comments, and calibration-anchored feedback — unlimited, for the year.
      </div>
      <a href="https://mathski.io" style="display:inline-block;background:#007aff;color:white;text-decoration:none;padding:12px 28px;border-radius:9999px;font-weight:700;font-size:15px;">Go to Mathski →</a>
      <div style="margin-top:16px;font-size:13px;color:#6b6b70;">Your access expires on ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}.</div>
    </div>
    <div style="background:#f2f2f7;border-radius:0 0 16px 16px;padding:14px 28px;text-align:center;border:1px solid #e5e5ea;border-top:none;">
      <div style="font-size:11px;color:#aeaeb2;">© 2026 Mathski. All rights reserved.</div>
    </div>
  </div>
</body>
</html>`
        })
      });
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
};
