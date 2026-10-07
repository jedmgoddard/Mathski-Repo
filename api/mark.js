const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Free-Email');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, model, max_tokens, course, pdfData, pdfType, textContent } = req.body;
  const authHeader = req.headers['authorization'];
  const freeEmail = req.headers['x-free-email'] || email;

  // --- AUTH CHECK ---
  let isTeacher = false;
  let isJWT = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      isJWT = true;
      // Check teacher role
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('email', user.email)
        .single();
      isTeacher = profile?.role === 'teacher';
    }
  }

  // For free email (action:'report' only), check users table marks_limit
  if (action === 'report' && !isJWT && freeEmail) {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    const { data: existing } = await supabase
      .from('users')
      .select('marks_limit, marks_used')
      .eq('email', freeEmail.toLowerCase())
      .single();

    // If they exist in users table, they've had their free trial
    // (free trial inserts them with marks_limit:0; paid purchases top up marks_limit)
    if (existing) {
      const remaining = (existing.marks_limit || 0) - (existing.marks_used || 0);
      if (remaining <= 0) {
        return res.status(403).json({ error: 'No marks remaining.' });
      }
    }
  }

  // --- BUILD MESSAGE CONTENT ---
  let messageContent;
  if (pdfData) {
    messageContent = [
      { type: 'document', source: { type: 'base64', media_type: pdfType || 'application/pdf', data: pdfData } },
      { type: 'text', text: 'Process this IB Mathematics IA as instructed.' }
    ];
  } else if (textContent) {
    messageContent = textContent;
  } else {
    return res.status(400).json({ error: 'No file content provided.' });
  }

  const isHL = (course || 'SLAI').startsWith('HL');

  // --- SCORES SYSTEM PROMPT ---
  const scoresSystemPrompt = `You are a strict IB Mathematics IA marker. Course: ${course || 'SLAI'}.

Mark ONLY the five criteria. Return ONLY valid JSON, no markdown, no preamble:
{"criteria":[{"letter":"A","name":"Presentation","max":4,"awarded":0,"verdict":"secure"},{"letter":"B","name":"Mathematical Communication","max":4,"awarded":0,"verdict":"secure"},{"letter":"C","name":"Personal Engagement","max":3,"awarded":0,"verdict":"secure"},{"letter":"D","name":"Reflection","max":3,"awarded":0,"verdict":"secure"},{"letter":"E","name":"Use of Mathematics","max":6,"awarded":0,"verdict":"secure"}],"total":0}

verdict must be one of: secure, borderline, vulnerable.

CRITERIA DESCRIPTORS:
A (0-4): 0 not reached | 1 some coherence OR organisation | 2 some coherence AND organisation | 3 coherent and well organised | 4 coherent, well organised AND concise
B (0-4): 0 not reached | 1 some relevant partially appropriate | 2 some relevant appropriate | 3 relevant appropriate mostly consistent | 4 relevant appropriate consistent throughout
C (0-3): 0 not reached | 1 some personal engagement | 2 significant — authentic, drives exploration on a few occasions | 3 outstanding — numerous high-quality instances, creative
D (0-3): 0 not reached | 1 limited — describing results only | 2 meaningful — links to aim, considers limitations | 3 substantial critical reflection throughout
E (0-6, ${isHL ? 'HL' : 'SL'}): ${isHL
  ? '0 not reached | 1 some relevant limited understanding | 2 some relevant partially correct some knowledge | 3 relevant HL-commensurate correct some knowledge | 4 relevant HL-commensurate correct good knowledge | 5 relevant HL-commensurate correct sophistication or rigour thorough knowledge | 6 relevant HL-commensurate precise sophistication AND rigour thorough knowledge'
  : '0 not reached | 1 some relevant maths | 2 some relevant limited understanding | 3 relevant SL-commensurate limited understanding | 4 relevant SL-commensurate partially correct some knowledge | 5 relevant SL-commensurate mostly correct good knowledge | 6 relevant SL-commensurate correct thorough knowledge'}

Be strict. C and D are most prone to over-award. Mark what is demonstrably present, not what was attempted.`;

  // --- REPORT SYSTEM PROMPT ---
  const reportSystemPrompt = `You are a strict, experienced IB Mathematics IA marker. Course: ${course || 'SLAI'}.

Produce a detailed marking report with criterion-by-criterion justifications and specific improvement actions.

Return ONLY valid JSON:
{"criteria":[{"letter":"A","name":"Presentation","max":4,"awarded":0,"verdict":"secure","reasoning":"","improvements":[]},{"letter":"B","name":"Mathematical Communication","max":4,"awarded":0,"verdict":"secure","reasoning":"","improvements":[]},{"letter":"C","name":"Personal Engagement","max":3,"awarded":0,"verdict":"secure","reasoning":"","improvements":[]},{"letter":"D","name":"Reflection","max":3,"awarded":0,"verdict":"secure","reasoning":"","improvements":[]},{"letter":"E","name":"Use of Mathematics","max":6,"awarded":0,"verdict":"secure","reasoning":"","improvements":[]}],"total":0,"overall_advice":"","red_flags":[]}

Fields:
- reasoning: 2-4 sentences explaining the mark, citing specific evidence from the IA
- improvements: array of 2-4 specific, actionable things the student can do to improve THIS criterion — concrete, not generic. e.g. "Add a sentence on p.7 linking your logistic model to the biological context before you interpret the parameters." NOT "Improve your reflection."
- overall_advice: 2-3 sentences of priority advice — what to tackle first for biggest mark gain
- red_flags: array of specific concerns that need attention (empty array if none)
- verdict: secure, borderline, or vulnerable

CRITERIA DESCRIPTORS:
A (0-4): 0 not reached | 1 some coherence OR organisation | 2 some coherence AND organisation | 3 coherent and well organised | 4 coherent, well organised AND concise
B (0-4): 0 not reached | 1 some relevant partially appropriate | 2 some relevant appropriate | 3 relevant appropriate mostly consistent | 4 relevant appropriate consistent throughout
C (0-3): 0 not reached | 1 some personal engagement | 2 significant — authentic, drives exploration on a few occasions | 3 outstanding — numerous high-quality instances, creative
D (0-3): 0 not reached | 1 limited — describing results only | 2 meaningful — links to aim, considers limitations | 3 substantial critical reflection throughout
E (0-6, ${isHL ? 'HL' : 'SL'}): ${isHL
  ? '0 not reached | 1 some relevant limited understanding | 2 some relevant partially correct some knowledge | 3 relevant HL-commensurate correct some knowledge | 4 relevant HL-commensurate correct good knowledge | 5 relevant HL-commensurate correct sophistication or rigour thorough knowledge | 6 relevant HL-commensurate precise sophistication AND rigour thorough knowledge'
  : '0 not reached | 1 some relevant maths | 2 some relevant limited understanding | 3 relevant SL-commensurate limited understanding | 4 relevant SL-commensurate partially correct some knowledge | 5 relevant SL-commensurate mostly correct good knowledge | 6 relevant SL-commensurate correct thorough knowledge'}

${isTeacher ? `TEACHER MODE: Also include a "coversheet_comment" field on each criterion (2-4 sentences, criterion verdict phrase first in bold using **bold**, professional moderation-ready language with page references where possible).` : ''}

CALIBRATION ANCHORS:
- lbz630 SLAI: A3,B3,C2,D2,E4=14 — IBO moderation confirmed
- mgd025 SLAI: A3,B2,C1,D1,E4=11
- lrg678 HLAA: A3,B3,C3,D3,E5=17

Be strict. Mark what is demonstrably present. C and D most prone to over-award.`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    if (action === 'scores') {
      // STAGE 1: fast scores only
      const response = await anthropic.messages.create({
        model: model || 'claude-sonnet-4-5',
        max_tokens: 800,
        system: scoresSystemPrompt,
        messages: [{ role: 'user', content: messageContent }]
      });

      const raw = response.content.map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);

    } else if (action === 'report') {
      // STAGE 2: full report + email
      const response = await anthropic.messages.create({
        model: model || 'claude-sonnet-4-5',
        max_tokens: max_tokens || 4000,
        system: reportSystemPrompt,
        messages: [{ role: 'user', content: messageContent }]
      });

      const raw = response.content.map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      // Record free trial in users table (marks_limit:0, marks_used:1)
      // Paid purchases via payment.js will top up marks_limit
      if (!isJWT && freeEmail) {
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_KEY
        );
        const email_lc = freeEmail.toLowerCase();
        const { data: existing } = await supabase
          .from('users')
          .select('id, marks_used')
          .eq('email', email_lc)
          .single();

        if (existing) {
          await supabase
            .from('users')
            .update({ marks_used: (existing.marks_used || 0) + 1, last_active: new Date().toISOString() })
            .eq('email', email_lc);
        } else {
          await supabase
            .from('users')
            .insert({
              email: email_lc,
              role: 'student',
              tier: 'student',
              marks_limit: 0,
              marks_used: 1,
              last_active: new Date().toISOString(),
            });
        }
      }

      // Send email via Resend
      if (freeEmail) {
        await sendReportEmail(freeEmail, parsed, course || 'SLAI', isTeacher);
      }

      return res.status(200).json({ success: true, total: parsed.total });

    } else {
      // Legacy fallback — treat as full report for teacher JWT
      const response = await anthropic.messages.create({
        model: model || 'claude-sonnet-4-5',
        max_tokens: max_tokens || 3000,
        system: reportSystemPrompt,
        messages: [{ role: 'user', content: messageContent }]
      });
      const raw = response.content.map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    }

  } catch (err) {
    console.error('mark.js error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// --- RESEND EMAIL ---
async function sendReportEmail(toEmail, report, course, isTeacher) {
  const criteriaHtml = report.criteria.map(c => {
    const verdictColor = c.verdict === 'secure' ? '#34c759' : c.verdict === 'borderline' ? '#ff9500' : '#ff3b30';
    const improvementsHtml = c.improvements && c.improvements.length
      ? '<ul style="margin:8px 0 0 0;padding-left:20px;">' +
        c.improvements.map(i => `<li style="color:#3c3c43;font-size:14px;margin-bottom:4px;">${i}</li>`).join('') +
        '</ul>'
      : '';
    const coversheetHtml = isTeacher && c.coversheet_comment
      ? `<div style="margin-top:10px;padding:10px 14px;background:#f2f2f7;border-radius:8px;font-size:13px;color:#3c3c43;"><strong>Coversheet comment:</strong> ${c.coversheet_comment}</div>`
      : '';
    return `
      <div style="border:1px solid #e5e5ea;border-radius:12px;padding:16px 20px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="width:32px;height:32px;border-radius:50%;background:#007aff;color:white;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;font-family:Nunito,sans-serif;flex-shrink:0;">${c.letter}</div>
          <div>
            <span style="font-weight:700;font-size:15px;color:#1c1c1e;">${c.name}</span>
            <span style="margin-left:8px;font-size:13px;color:#6b6b70;">${c.awarded}/${c.max}</span>
            <span style="margin-left:8px;display:inline-block;padding:2px 10px;border-radius:9999px;background:${verdictColor}22;color:${verdictColor};font-size:12px;font-weight:700;text-transform:uppercase;">${c.verdict}</span>
          </div>
        </div>
        <div style="font-size:14px;color:#3c3c43;line-height:1.5;margin-bottom:${improvementsHtml ? '10px' : '0'}">${c.reasoning}</div>
        ${improvementsHtml ? `<div style="font-size:13px;font-weight:700;color:#1c1c1e;margin-top:8px;">To improve this criterion:</div>${improvementsHtml}` : ''}
        ${coversheetHtml}
      </div>`;
  }).join('');

  const redFlagsHtml = report.red_flags && report.red_flags.length
    ? `<div style="border:1px solid #ff3b3022;border-radius:12px;padding:16px 20px;margin-bottom:20px;background:#ff3b3008;">
        <div style="font-weight:700;color:#ff3b30;margin-bottom:8px;">⚑ Red Flags</div>
        <ul style="margin:0;padding-left:20px;">${report.red_flags.map(f => `<li style="color:#3c3c43;font-size:14px;margin-bottom:4px;">${f}</li>`).join('')}</ul>
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f2f7;font-family:'Nunito Sans',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="background:#007aff;border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
      <div style="font-family:Nunito,Helvetica,Arial,sans-serif;font-size:26px;font-weight:800;color:white;letter-spacing:-0.5px;">Math<span style="opacity:0.85">ski</span></div>
      <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">IB Mathematics IA Report</div>
    </div>

    <!-- Score banner -->
    <div style="background:white;padding:20px 28px;border-left:1px solid #e5e5ea;border-right:1px solid #e5e5ea;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#6b6b70;font-weight:700;">Course</div>
          <div style="font-size:18px;font-weight:800;font-family:Nunito,Helvetica,Arial,sans-serif;color:#1c1c1e;">${course}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#6b6b70;font-weight:700;">Total</div>
          <div style="font-size:36px;font-weight:800;font-family:Nunito,Helvetica,Arial,sans-serif;color:#007aff;">${report.total}<span style="font-size:18px;color:#aeaeb2;">/20</span></div>
        </div>
      </div>
    </div>

    <!-- Overall advice -->
    ${report.overall_advice ? `
    <div style="background:#e8f2ff;border-left:1px solid #c5dbff;border-right:1px solid #c5dbff;padding:16px 28px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#007aff;font-weight:700;margin-bottom:6px;">Priority Advice</div>
      <div style="font-size:14px;color:#1c1c1e;line-height:1.6;">${report.overall_advice}</div>
    </div>` : ''}

    <!-- Criteria -->
    <div style="background:white;padding:20px 28px;border:1px solid #e5e5ea;border-top:none;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#6b6b70;font-weight:700;margin-bottom:14px;">Criterion Breakdown</div>
      ${criteriaHtml}
      ${redFlagsHtml}
    </div>

    <!-- Footer -->
    <div style="background:#f2f2f7;border-radius:0 0 16px 16px;padding:16px 28px;text-align:center;border:1px solid #e5e5ea;border-top:none;">
      <div style="font-size:12px;color:#aeaeb2;">© 2026 Mathski. All rights reserved.</div>
      <div style="font-size:11px;color:#c7c7cc;margin-top:4px;">IB Mathematics IA and Revision Tool — mathski.io</div>
      <div style="font-size:11px;color:#c7c7cc;margin-top:4px;">This report is a marking aid. All marks should be reviewed by your teacher.</div>
    </div>

  </div>
</body>
</html>`;

  const subject = `Your Mathski IA Report — ${report.total}/20 (${course})`;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Mathski <reports@mathski.io>',
      to: [toEmail],
      subject,
      html
    })
  });

  if (!resendResponse.ok) {
    const err = await resendResponse.text();
    console.error('Resend error:', err);
    // Don't throw — email failure shouldn't block the response
  }
}
