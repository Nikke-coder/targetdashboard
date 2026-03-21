export const config = { runtime: 'nodejs' };

// Credit package price IDs (one-time payments)
const CREDIT_PACKAGES = {
  spark:   { priceId: 'price_1TBr8936nlMWZMRYRFZb0mAv', credits: 200 },
  insight: { priceId: 'price_1TBr9B36nlMWZMRYjnbtW4iB', credits: 400 },
  oracle:  { priceId: 'price_1TBr9o36nlMWZMRYypTwoHC2', credits: 1000 },
};

// MainUser subscription price ID
const SUBSCRIPTION_PRICE_ID = 'price_1TBrBQ36nlMWZMRYgi6eSlZ3';

export default async function handler(req, res) {
  if(req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  if(!STRIPE_SECRET) return res.status(500).json({ error: 'Stripe not configured' });

  try {
    const { user_id, user_email, company_name } = req.body;

    // Determine if this is a credit package purchase or a subscription
    const packageName = req.body.package; // "spark", "insight", "oracle", or undefined for subscription
    const isCredits   = packageName && CREDIT_PACKAGES[packageName];

    if(!user_email) {
      return res.status(400).json({ error: 'Missing user_email' });
    }

    const params = new URLSearchParams();

    if(isCredits) {
      // ── One-time credit purchase ──
      const pkg = CREDIT_PACKAGES[packageName];
      params.append('mode', 'payment');
      params.append('line_items[0][price]', pkg.priceId);
      params.append('line_items[0][quantity]', '1');
      params.append('success_url', 'https://app.targetdash.ai?credits=success&package=' + packageName);
      params.append('cancel_url', 'https://app.targetdash.ai?credits=cancelled');
      params.append('customer_email', user_email);
      params.append('metadata[user_id]', user_id || '');
      params.append('metadata[user_email]', user_email);
      params.append('metadata[package]', packageName);
      params.append('metadata[credits]', String(pkg.credits));
      params.append('metadata[type]', 'credits');
    } else {
      // ── Monthly subscription ──
      params.append('mode', 'subscription');
      params.append('line_items[0][price]', SUBSCRIPTION_PRICE_ID);
      params.append('line_items[0][quantity]', '1');
      params.append('success_url', 'https://app.targetdash.ai?payment=success');
      params.append('cancel_url', 'https://www.targetdash.ai/onboarding?mode=subscribe');
      params.append('customer_email', user_email);
      params.append('metadata[user_id]', user_id || '');
      params.append('metadata[user_email]', user_email);
      params.append('metadata[company_name]', company_name || '');
      params.append('metadata[type]', 'subscription');
      params.append('allow_promotion_codes', 'true');
      params.append('billing_address_collection', 'auto');
      params.append('tax_id_collection[enabled]', 'true');
    }

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
    console.error('create-checkout error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
