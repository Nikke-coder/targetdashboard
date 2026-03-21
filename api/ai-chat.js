export const config = { runtime: 'nodejs' };

const SUPABASE_URL         = process.env.SUPABASE_URL || 'https://nghlvfngpfrhhigkoeem.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Rate limiter — max 30 AI requests per user per minute ────────────
const RATE_LIMIT  = 30;
const RATE_WINDOW = 60; // seconds

async function checkRateLimit(userEmail) {
  if(!SUPABASE_SERVICE_KEY || !userEmail) return true;
  const windowStart = new Date(Date.now() - RATE_WINDOW * 1000).toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_transactions?user_email=eq.${encodeURIComponent(userEmail)}&created_at=gte.${windowStart}&select=id`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const data = await res.json();
    return !data || data.length < RATE_LIMIT;
  } catch(e) {
    return true; // fail open
  }
}

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
  if(!MISTRAL_KEY) return res.status(500).json({ error: 'AI not configured' });

  try {
    const { messages, system, user_email } = req.body;

    if(!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }

    // Rate limit check
    if(user_email) {
      const allowed = await checkRateLimit(user_email);
      if(!allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please wait a minute before trying again.' });
      }
    }

    // Cap conversation length
    const trimmedMessages = messages.slice(-20);

    // Build Mistral message format
    const mistralMessages = [
      { role: 'system', content: system || 'You are a helpful financial advisor.' },
      ...trimmedMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 4000),
      })),
    ];

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_KEY}`,
      },
      body: JSON.stringify({
        model: 'mistral-medium-latest',
        max_tokens: 600,
        temperature: 0.4,
        messages: mistralMessages,
      }),
    });

    const data = await response.json();
    if(!response.ok) throw new Error(data.message || data.detail || 'Mistral error');

    const text = data.choices?.[0]?.message?.content || 'No response generated.';
    return res.status(200).json({ text });

  } catch(e) {
    console.error('ai-chat error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
