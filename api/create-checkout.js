export const config = { runtime: 'nodejs' };

// Credit package price IDs (from Stripe)
const PACKAGES = {
  spark:   { priceId: 'price_1TBr8936nlMWZMRYRFZb0mAv', credits: 200 },
  insight: { priceId: 'price_1TBr9B36nlMWZMRYjnbtW4iB', credits: 400 },
  oracle:  { priceId: 'price_1TBr9o36nlMWZMRYypTwoHC2', credits: 1000 },
};

// Subscription price ID (€80/mo)
const SUB_PRICE_ID = 'price_1TBrBQ36nlMWZMRYgi6eSlZ3';

export default async function handler(req, res) {
  if(req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  if(!STRIPE_SECRET) return res.status(500).json({ error: 'Stripe not configured' });

  try {
    const { user_id, user_email, company_name } = req.body;

    // ── Credit package checkout (from BillingView in app) ──
    const pkgName = req.body.package;
    if(pkgName && PACKAGES[pkgName]) {
      const pkg = PACKAGES[pkgName];

      const params = new URLSearchParams();
      params.append('mode', 'payment');
      params.append('line_items[0][price]', pkg.priceId);
      params.append('line_items[0][quantity]', '1');
      params.append('success_url', 'https://app.targetdash.ai?billing=success');
      params.append('cancel_url', 'https://app.targetdash.ai');
      if(user_email) params.append('customer_email', user_email);
      params.append('metadata[type]', 'credits');
      params.append('metadata[package]', pkgName);
      params.append('metadata[credits]', String(pkg.credits));
      params.append('metadata[user_email]', user_email || '');
      params.append('metadata[client]', req.body.client || '');

      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const session = await stripeRes.json();
      if(!stripeRes.ok) throw new Error(session.error?.message || 'Stripe error');

      return res.status(200).json({ url: session.url });
    }

    // ── Subscription checkout (from onboarding) ──
    if(!user_email) return res.status(400).json({ error: 'Missing user_email' });

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', SUB_PRICE_ID);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', 'https://app.targetdash.ai?payment=success');
    params.append('cancel_url', 'https://www.targetdash.ai/onboarding?mode=subscribe');
    params.append('customer_email', user_email);
    params.append('metadata[type]', 'subscription');
    params.append('metadata[user_id]', user_id || '');
    params.append('metadata[user_email]', user_email);
    params.append('metadata[company_name]', company_name || '');
    params.append('allow_promotion_codes', 'true');
    params.append('billing_address_collection', 'auto');
    params.append('tax_id_collection[enabled]', 'true');

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if(!stripeRes.ok) throw new Error(session.error?.message || 'Stripe error');

    return res.status(200).json({ url: session.url });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
