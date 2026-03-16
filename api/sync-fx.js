// api/sync-fx.js — Fetch FX rates from ECB/Suomen Pankki
// Called automatically via Vercel Cron or manually
// Cron: add to vercel.json: {"crons":[{"path":"/api/sync-fx","schedule":"0 16 * * 1-5"}]}

import { createClient } from "@supabase/supabase-js";

const CURRENCIES = ["SEK","NOK","USD","GBP","DKK","CHF","PLN","HUF","CZK"];
const ECB_URL = `https://data-api.ecb.europa.eu/service/data/EXR/D.${CURRENCIES.join("+")}.EUR.SP00.A?format=csvdata&startPeriod=2020-01-01&detail=dataonly`;

// Both Supabase projects get the same rates
const PROJECTS = [
  { url: "https://jzqgndcrukggcwthxyrv.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6cWduZGNydWtnZ2N3dGh4eXJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjk1MDc0MiwiZXhwIjoyMDg4NTI2NzQyfQ.9MN8k-RkBYskeAYDpBQAKWVEoT_L81-uy4ivV_b0L5w" },
  { url: "https://wzooguqwbuxepwkffwpp.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6b29ndXF3YnV4ZXB3a2Zmd3BwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg2ODg0NSwiZXhwIjoyMDg4NDQ0ODQ1fQ.BiW0Z34CG_cNsPNzyZtvuUn5ulCs149c-DYXncmu0MU" },
];

export default async function handler(req, res) {
  try {
    // Fetch CSV from ECB
    const resp = await fetch(ECB_URL, { headers: { Accept: "text/csv" } });
    if(!resp.ok) throw new Error(`ECB fetch failed: ${resp.status}`);
    const csv = await resp.text();

    // Parse CSV — format: DATE,CURRENCY,RATE,...
    const rows = [];
    const lines = csv.split("\n").filter(l=>l.trim()&&!l.startsWith("KEY"));
    for(const line of lines) {
      const parts = line.split(",");
      // ECB CSV: key column contains currency e.g. "D.SEK.EUR.SP00.A"
      const keyCol = parts[0]||"";
      const currMatch = keyCol.match(/D\.([A-Z]{3})\.EUR/);
      if(!currMatch) continue;
      const currency = currMatch[1];
      const date     = parts[1]?.trim();
      const rate     = parseFloat(parts[2]?.trim());
      if(!date||isNaN(rate)||rate<=0) continue;
      rows.push({ date, currency, rate });
    }

    if(rows.length===0) throw new Error("No rates parsed from ECB response");

    // Upsert into both Supabase projects
    const results = [];
    for(const proj of PROJECTS) {
      const sb = createClient(proj.url, proj.key);
      const { error, count } = await sb.from("fx_rates")
        .upsert(rows, { onConflict: "date,currency" });
      results.push({ url: proj.url, error: error?.message, count });
    }

    return res.json({
      ok: true,
      rows: rows.length,
      latest: rows.slice(-5),
      projects: results,
    });

  } catch(err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
