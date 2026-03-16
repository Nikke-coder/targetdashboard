# Targetflow Dashboard — Uuden asiakkaan käyttöönotto

## 1. Supabase

Avaa `src/supabase.js` ja täytä:

```js
const URL = "https://PROJEKTI.supabase.co"   // Supabase → Settings → API → Project URL
const KEY = "eyJ..."                           // Supabase → Settings → API → anon (public) key
export const CLIENT = 'Yritys Oy'             // Asiakkaan virallinen nimi (täsmää ai_credits-tauluun)
```

## 2. App.jsx

Avaa `src/App.jsx` ja muokkaa rivi ~50:

```js
const ACCENT      = '#818cf8';   // Asiakkaan väri (hex)
const CLIENT_NAME = 'Yritys Oy'; // Sama kuin supabase.js:n CLIENT
```

## 3. Anthropic API-avain

Lisää Verceliin env-muuttuja:
```
VITE_ANTHROPIC_KEY = sk-ant-...
```

## 4. Stripe (billing)

Lisää Verceliin:
```
STRIPE_SECRET_KEY        = sk_live_...
STRIPE_WEBHOOK_SECRET    = whsec_...
STRIPE_PRICE_SPARK       = price_...   (€10)
STRIPE_PRICE_INSIGHT     = price_...   (€20)
STRIPE_PRICE_ORACLE      = price_...   (€50)
NEXT_PUBLIC_URL          = https://asiakas-dashboard.vercel.app
```

## 5. Supabase — aja SQL

Aja molemmissa Supabase-projekteissa (tai vain asiakkaan projektissa):

```sql
-- Lisää asiakas credits-tauluun
INSERT INTO ai_credits (client, balance)
VALUES ('Yritys Oy', 0)
ON CONFLICT (client) DO NOTHING;
```

## 6. GitHub → Vercel

1. Luo uusi GitHub-repo (esim. `Nikke-coder/yritys-dashboard`)
2. Push tämä kansio sinne
3. Yhdistä Verceliin → automaattinen deploy

## Aksenttivärit per asiakas

| Asiakas | Väri |
|---------|------|
| Cuuma | `#60a5fa` |
| Strand | `#60a5fa` |
| Stremet | `#818cf8` |
| Manutec | `#38bdf8` |
| Accrease | `#86efac` |
| Drop Design | `#38bdf8` |
| Niittysiemen | `#4ade80` |
| Tepcomp | `#2dd4bf` |
