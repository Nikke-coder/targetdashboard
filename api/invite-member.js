import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://wzooguqwbuxepwkffwpp.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, client, invited_by } = req.body || {};

    if (!email)  return res.status(400).json({ error: "Missing email" });
    if (!client) return res.status(400).json({ error: "Missing client" });

    const redirectTo = `${process.env.NEXT_PUBLIC_URL || "https://" + process.env.VERCEL_URL}`;

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { client, invited_by: invited_by || "" },
    });

    if (error) {
      console.error("Invite error:", error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ ok: true, user_id: data?.user?.id });

  } catch (err) {
    console.error("invite-member error:", err);
    return res.status(500).json({ error: err.message });
  }
}
