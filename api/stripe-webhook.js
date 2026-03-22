export const config = { api: { bodyParser: false } };

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL          = process.env.SUPABASE_URL || 'https://nghlvfngpfrhhigkoeem.supabase.co';
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function verifyStripeSignature(payload, signature, secret) {
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {});
  const timestamp = parts['t'];
  const sig = parts['v1'];
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(signatureBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === sig;
}

// ── Supabase REST helpers ──
const headers = () => ({
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
});

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  return res.json();
}

async function sbInsert(table, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
}

async function sbUpdate(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify(body),
  });
}

// ── Add credits atomically via Postgres function ──
async function addCredits(userEmail, client, amount) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_user_email: userEmail, p_client: client, p_amount: amount }),
  });
  const newBalance = await res.json();
  return newBalance;
}

// ── Main handler ──
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const payload = await readBody(req);
  const signature = req.headers['stripe-signature'];

  try {
    const valid = await verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET);
    if (!valid) return res.status(400).send('Invalid signature');
  } catch (e) {
    return res.status(400).send('Signature error');
  }

  const event = JSON.parse(payload);

  try {
    if (event.type === 'checkout.session.completed') {
      const session     = event.data.object;
      const sessionId   = session.id;
      const user_email  = session.metadata?.user_email;
      const metaType    = session.metadata?.type;
      const user_id     = session.metadata?.user_id;
      const customer_id = session.customer;
      const sub_id      = session.subscription;

      if (!user_email) return res.status(400).send('No user email');

      // Idempotency check
      try {
        const existing = await sbGet(`ai_transactions?stripe_session_id=eq.${sessionId}&select=id&limit=1`);
        if (existing && existing.length > 0) return res.status(200).send('Already processed');
      } catch (e) { /* continue */ }

      // ── CREDIT PACKAGE PURCHASE ──
      if (metaType === 'credits') {
        const packageName = session.metadata?.package;
        const credits     = parseInt(session.metadata?.credits) || 0;
        if (credits <= 0) return res.status(400).send('Invalid credits');

        const clientName = session.metadata?.company_name || user_email;

        // Add credits using reliable SELECT → UPDATE/INSERT
        await addCredits(user_email, clientName, credits);

        // Record transaction
        await sbInsert('ai_transactions', {
          user_email,
          client: clientName,
          credits,
          type: 'purchase',
          package: packageName,
          stripe_session_id: sessionId,
          created_at: new Date().toISOString(),
        });

        return res.status(200).send('Credits added');
      }

      // ── SUBSCRIPTION PAYMENT ──
      const query = user_id ? `user_id=eq.${user_id}` : `email=eq.${encodeURIComponent(user_email)}`;

      await sbUpdate(`user_profiles?${query}`, {
        plan: 'mainuser',
        stripe_customer_id: customer_id,
        stripe_sub_id: sub_id,
        plan_activated_at: new Date().toISOString(),
        onboarded: true,
      });

      // Grant 100 initial credits
      const clientName = session.metadata?.company_name || user_email;
      await addCredits(user_email, clientName, 100);

      await sbInsert('ai_transactions', {
        user_email,
        client: clientName,
        credits: 100,
        type: 'purchase',
        package: 'subscription_initial',
        stripe_session_id: sessionId,
        created_at: new Date().toISOString(),
      });
    }

    if (event.type === 'customer.subscription.deleted') {
      const customer_id = event.data.object.customer;
      await sbUpdate(`user_profiles?stripe_customer_id=eq.${customer_id}`, {
        plan: 'cancelled',
      });
    }

    return res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e.message);
    return res.status(500).send('Error: ' + e.message);
  }
}
