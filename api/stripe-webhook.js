export const config = { runtime: 'nodejs', api: { bodyParser: false } };

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL           = process.env.SUPABASE_URL || 'https://nghlvfngpfrhhigkoeem.supabase.co';
const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

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
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload)
  );

  const expected = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === sig;
}

// Helper: call Supabase REST API
async function supabasePatch(table, filter, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

async function supabasePost(table, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

async function supabaseGet(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&limit=1`, {
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  const rows = await res.json();
  return rows?.[0] || null;
}

export default async function handler(req) {
  if(req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const payload   = await req.text();
  const signature = req.headers.get('stripe-signature');

  try {
    const valid = await verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET);
    if(!valid) return new Response('Invalid signature', { status: 400 });
  } catch(e) {
    return new Response('Signature error', { status: 400 });
  }

  const event = JSON.parse(payload);

  // ── Checkout completed ──────────────────────────────────────────────────
  if(event.type === 'checkout.session.completed') {
    const session     = event.data.object;
    const metaType    = session.metadata?.type;
    const user_email  = session.metadata?.user_email;

    // ── Credit package purchase ───────────────────────────────────────────
    if(metaType === 'credits') {
      const pkgName     = session.metadata?.package;
      const creditCount = parseInt(session.metadata?.credits) || 0;
      const receiptUrl  = session.receipt_url || null;

      if(!user_email || !creditCount) {
        return new Response('Missing credit info', { status: 400 });
      }

      // Upsert ai_credits — add to existing balance
      const existing = await supabaseGet('ai_credits', `user_email=eq.${encodeURIComponent(user_email)}`);
      const newBalance = (existing?.balance || 0) + creditCount;

      if(existing) {
        await supabasePatch('ai_credits',
          `user_email=eq.${encodeURIComponent(user_email)}`,
          { balance: newBalance, updated_at: new Date().toISOString() }
        );
      } else {
        await supabasePost('ai_credits', {
          user_email,
          balance: newBalance,
          unlimited: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      // Record transaction
      await supabasePost('ai_transactions', {
        user_email,
        type:       'purchase',
        credits:    creditCount,
        package:    pkgName,
        receipt_url: receiptUrl,
        created_at: new Date().toISOString(),
      });

      return new Response('Credits added', { status: 200 });
    }

    // ── Subscription purchase ─────────────────────────────────────────────
    const user_id     = session.metadata?.user_id;
    const customer_id = session.customer;
    const sub_id      = session.subscription;

    if(!user_id && !user_email) {
      return new Response('No user info', { status: 400 });
    }

    const query = user_id
      ? `user_id=eq.${user_id}`
      : `email=eq.${encodeURIComponent(user_email)}`;

    await supabasePatch('user_profiles', query, {
      plan:              'mainuser',
      stripe_customer_id: customer_id,
      stripe_sub_id:      sub_id,
      plan_activated_at:  new Date().toISOString(),
      onboarded:          true,
    });
  }

  // ── Subscription cancelled ──────────────────────────────────────────────
  if(event.type === 'customer.subscription.deleted') {
    const sub         = event.data.object;
    const customer_id = sub.customer;

    await supabasePatch('user_profiles',
      `stripe_customer_id=eq.${customer_id}`,
      { plan: 'cancelled' }
    );
  }

  return new Response('OK', { status: 200 });
}
