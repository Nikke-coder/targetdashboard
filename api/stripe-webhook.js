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
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(signatureBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === sig;
}

async function sbRest(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal',
    },
  };
  if(body) opts.body = JSON.stringify(body);
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  return res.json();
}

export default async function handler(req) {
  if(req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const payload   = await req.text();
  const signature = req.headers.get('stripe-signature');

  try {
    const valid = await verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET);
    if(!valid) return new Response('Invalid signature', { status: 400 });
  } catch(e) {
    return new Response('Signature error', { status: 400 });
  }

  const event = JSON.parse(payload);

  if(event.type === 'checkout.session.completed') {
    const session     = event.data.object;
    const sessionId   = session.id;
    const user_email  = session.metadata?.user_email;
    const metaType    = session.metadata?.type;
    const user_id     = session.metadata?.user_id;
    const customer_id = session.customer;
    const sub_id      = session.subscription;

    if(!user_email) return new Response('No user email', { status: 400 });

    // ── IDEMPOTENCY — prevent double processing on Stripe retry ──
    try {
      const existing = await sbGet(`ai_transactions?stripe_session_id=eq.${sessionId}&select=id&limit=1`);
      if(existing && existing.length > 0) return new Response('Already processed', { status: 200 });
    } catch(e) { /* continue if check fails */ }

    // ── CREDIT PACKAGE PURCHASE ──
    if(metaType === 'credits') {
      const packageName = session.metadata?.package;
      const credits     = parseInt(session.metadata?.credits) || 0;
      if(credits <= 0) return new Response('Invalid credits', { status: 400 });

      const balData = await sbGet(`ai_credits?user_email=eq.${encodeURIComponent(user_email)}&select=balance,unlimited`);
      const currentBal  = balData?.[0]?.balance ?? 0;
      const isUnlimited = balData?.[0]?.unlimited ?? false;
      const newBal = isUnlimited ? currentBal : currentBal + credits;

      await sbRest('POST', 'ai_credits?on_conflict=user_email', {
        user_email, balance: newBal, updated_at: new Date().toISOString(),
      });

      await sbRest('POST', 'ai_transactions', {
        user_email,
        client: session.metadata?.company_name || user_email,
        credits,
        type: 'purchase',
        package: packageName,
        stripe_session_id: sessionId,
        receipt_url: session.receipt_url || null,
        created_at: new Date().toISOString(),
      });

      return new Response('Credits added', { status: 200 });
    }

    // ── SUBSCRIPTION PAYMENT ──
    const query = user_id ? `user_id=eq.${user_id}` : `email=eq.${encodeURIComponent(user_email)}`;

    await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?${query}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        plan: 'mainuser', stripe_customer_id: customer_id, stripe_sub_id: sub_id,
        plan_activated_at: new Date().toISOString(), onboarded: true,
      }),
    });

    await sbRest('POST', 'ai_credits?on_conflict=user_email', {
      user_email, balance: 100, updated_at: new Date().toISOString(),
    });

    await sbRest('POST', 'ai_transactions', {
      user_email, client: session.metadata?.company_name || user_email,
      credits: 100, type: 'purchase', package: 'subscription_initial',
      stripe_session_id: sessionId, created_at: new Date().toISOString(),
    });
  }

  if(event.type === 'customer.subscription.deleted') {
    const customer_id = event.data.object.customer;
    await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?stripe_customer_id=eq.${customer_id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ plan: 'cancelled' }),
    });
  }

  return new Response('OK', { status: 200 });
}
