export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
  if(!MISTRAL_KEY) return res.status(500).json({ error: 'AI not configured' });

  try {
    const { messages, system } = req.body;
    if(!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing messages' });
    }

    // Build message array — Mistral uses OpenAI-compatible format
    // System prompt goes as first message with role "system"
    const mistralMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ];

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_KEY}`,
      },
      body: JSON.stringify({
        model: 'mistral-medium-latest',
        max_tokens: 800,
        temperature: 0.3,   // Low temp — factual financial analysis
        messages: mistralMessages,
      }),
    });

    const data = await response.json();
    if(!response.ok) throw new Error(data.message || data.error?.message || 'Mistral error');

    const text = data.choices?.[0]?.message?.content || 'No response generated.';
    return res.status(200).json({ text });

  } catch(e) {
    console.error('ai-chat error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
