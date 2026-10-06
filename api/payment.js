// /api/payment.js
// Lemon Squeezy webhook handler → Supabase + Resend
// Vercel serverless function

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ── Product variant IDs (set in Vercel env vars) ─────────────────────────────
const PRODUCTS = {
  STUDENT: process.env.LS_STUDENT_VARIANT_ID,
  TEACHER: process.env.LS_TEACHER_VARIANT_ID,
};

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Verify Lemon Squeezy HMAC signature ──────────────────────────────────────
function verifySignature(rawBody, signature) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

// ── Magic link generator ──────────────────────────────────────────────────────
async function generateMagicLink(email) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: 'https://mathski.io' },
  });
  if (error) throw new Error(`Magic link error: ${error.message}`);
  return data.properties?.action_link;
}

// ── Email templates ───────────────────────────────────────────────────────────
function teacherEmailHTML(magicLink) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body { margin: 0; background: #f2f4f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { background: #1a56db; padding: 32px; text-align: center; }
  .header img { height: 48px; }
  .body { padding: 40px 36px; }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #1a1a1a; }
  p { margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 15px; }
  .cta { display: block; width: fit-content; margin: 28px 0; background: #1a56db; color: #fff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-size: 15px; font-weight: 600; }
  .feature-list { background: #f2f4f8; border-radius: 10px; padding: 20px 24px; margin: 20px 0; }
  .feature-list li { color: #333; font-size: 14px; line-height: 2; list-style: none; padding: 0; }
  .feature-list li::before { content: "✓ "; color: #248a3d; font-weight: 700; }
  .footer { padding: 20px 36px; border-top: 1px solid #eee; font-size: 12px; color: #999; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Mathski</div>
  </div>
  <div class="body">
    <h1>Welcome to Mathski Teacher 🎉</h1>
    <p>Your annual Teacher subscription is confirmed. You now have unlimited IA marking for your full cohort.</p>
    <ul class="feature-list">
      <li>Unlimited IA marks — all four IB courses</li>
      <li>Criterion-by-criterion breakdown (A–E)</li>
      <li>Coversheet comment drafts</li>
      <li>IB-calibrated, moderation-ready feedback</li>
      <li>Access to all practice worksheets</li>
    </ul>
    <p>Click the button below to sign in — no password needed. This link expires in 24 hours.</p>
    <a class="cta" href="${magicLink}">Sign in to Mathski →</a>
    <p style="font-size:13px;color:#888;">If the button doesn't work, paste this link into your browser:<br>
    <span style="word-break:break-all;color:#1a56db;">${magicLink}</span></p>
  </div>
  <div class="footer">© 2025 Mathski · mathski.io · <a href="mailto:hello@mathski.io" style="color:#1a56db;">hello@mathski.io</a></div>
</div>
</body>
</html>`;
}

function studentEmailHTML(magicLink, marksLimit) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body { margin: 0; background: #f2f4f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { background: #1a56db; padding: 32px; text-align: center; }
  .body { padding: 40px 36px; }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #1a1a1a; }
  p { margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 15px; }
  .cta { display: block; width: fit-content; margin: 28px 0; background: #1a56db; color: #fff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-size: 15px; font-weight: 600; }
  .marks-badge { background: #eaf2ff; border-radius: 10px; padding: 16px 20px; margin: 20px 0; text-align: center; }
  .marks-badge .num { font-size: 40px; font-weight: 800; color: #1a56db; line-height: 1; }
  .marks-badge .label { font-size: 13px; color: #555; margin-top: 4px; }
  .footer { padding: 20px 36px; border-top: 1px solid #eee; font-size: 12px; color: #999; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Mathski</div>
  </div>
  <div class="body">
    <h1>You're ready to mark 🎯</h1>
    <p>Payment confirmed. Your Mathski student credits are loaded and ready.</p>
    <div class="marks-badge">
      <div class="num">${marksLimit}</div>
      <div class="label">IA marks in your account</div>
    </div>
    <p>Each mark gives you a full criterion-by-criterion breakdown (A–E) with IB-calibrated feedback — the same standard used in moderation.</p>
    <p>Click below to sign in and start marking. No password needed. This link expires in 24 hours.</p>
    <a class="cta" href="${magicLink}">Sign in to Mathski →</a>
    <p style="font-size:13px;color:#888;">If the button doesn't work, paste this link into your browser:<br>
    <span style="word-break:break-all;color:#1a56db;">${magicLink}</span></p>
  </div>
  <div class="footer">© 2025 Mathski · mathski.io · <a href="mailto:hello@mathski.io" style="color:#1a56db;">hello@mathski.io</a></div>
</div>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Collect raw body for HMAC verification
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // Verify signature
  const signature = req.headers['x-signature'];
  if (!signature || !verifySignature(rawBody, signature)) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName = event.meta?.event_name;
  console.log('LS webhook received:', eventName);

  // Only handle order_created
  if (eventName !== 'order_created') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const order = event.data?.attributes;
  const email = order?.user_email?.toLowerCase();
  const variantId = String(event.data?.relationships?.order_items?.data?.[0]?.id || '');
  const orderId = String(event.data?.id || '');
  const customerId = String(order?.customer_id || '');

  // Resolve variant from order items (LS nests them)
  // Check meta.custom_data or first_order_item variant_id
  const firstItem = order?.first_order_item;
  const purchasedVariantId = String(firstItem?.variant_id || '');

  console.log(`Order: email=${email}, variant=${purchasedVariantId}, orderId=${orderId}`);

  if (!email) {
    return res.status(400).json({ error: 'No email in order' });
  }

  try {
    if (purchasedVariantId === PRODUCTS.TEACHER) {
      // ── Teacher purchase ───────────────────────────────────────────────────
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      const { error: upsertError } = await supabase
        .from('users')
        .upsert({
          email,
          role: 'teacher',
          tier: 'teacher',
          marks_limit: -1,
          lemon_order_id: orderId,
          lemon_customer_id: customerId,
          expires_at: expiresAt.toISOString(),
          last_active: new Date().toISOString(),
        }, { onConflict: 'email' });

      if (upsertError) throw new Error(`Supabase upsert error: ${upsertError.message}`);

      const magicLink = await generateMagicLink(email);

      await resend.emails.send({
        from: 'Mathski <noreply@mathski.io>',
        to: email,
        subject: 'Welcome to Mathski Teacher — sign in here',
        html: teacherEmailHTML(magicLink),
      });

      console.log(`Teacher account created/updated for ${email}`);

    } else if (purchasedVariantId === PRODUCTS.STUDENT) {
      // ── Student purchase ───────────────────────────────────────────────────
      const MARKS_PER_PURCHASE = 2; // each £3.49 purchase = 2 marks

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, marks_limit, marks_used')
        .eq('email', email)
        .single();

      let newMarksLimit;

      if (existingUser) {
        // Top up existing account
        newMarksLimit = (existingUser.marks_limit || 0) + MARKS_PER_PURCHASE;
        const { error: updateError } = await supabase
          .from('users')
          .update({
            marks_limit: newMarksLimit,
            tier: 'student',
            lemon_order_id: orderId,
            lemon_customer_id: customerId,
            last_active: new Date().toISOString(),
          })
          .eq('email', email);

        if (updateError) throw new Error(`Supabase update error: ${updateError.message}`);
      } else {
        // New student account
        newMarksLimit = MARKS_PER_PURCHASE;
        const { error: insertError } = await supabase
          .from('users')
          .insert({
            email,
            role: 'student',
            tier: 'student',
            marks_used: 0,
            marks_limit: newMarksLimit,
            lemon_order_id: orderId,
            lemon_customer_id: customerId,
            last_active: new Date().toISOString(),
          });

        if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);
      }

      const magicLink = await generateMagicLink(email);

      await resend.emails.send({
        from: 'Mathski <noreply@mathski.io>',
        to: email,
        subject: `Your ${newMarksLimit} Mathski marks are ready`,
        html: studentEmailHTML(magicLink, newMarksLimit),
      });

      console.log(`Student account created/topped up for ${email}, marks=${newMarksLimit}`);

    } else {
      console.warn(`Unknown variant ID: ${purchasedVariantId}`);
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook handler error:', err.message);
    // Return 200 to prevent LS retrying — log the error
    return res.status(200).json({ ok: false, error: err.message });
  }
}
