import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://nghlvfngpfrhhigkoeem.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if(req.method === "OPTIONS") return res.status(200).end();
  if(req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, company_name, role, plan, invited_by } = req.body || {};
    if(!email)        return res.status(400).json({ error: "Missing email" });
    if(!company_name) return res.status(400).json({ error: "Missing company_name" });

    const userPlan = plan || "mainuser";
    const userRole = role || "CEO";

    // Redirect to onboarding with invite mode — they must agree to legal terms
    const redirectTo = "https://www.targetdash.ai/onboarding?mode=invite";

    const { data: inviteData, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { company_name, role: userRole, plan: userPlan, invited_by: invited_by || "" },
    });

    if(inviteErr) {
      // User already exists — update profile and keep onboarded:false so they re-agree
      if(inviteErr.message?.includes("already been registered")) {
        const { data: existing } = await sb.from("user_profiles")
          .select("user_id").eq("email", email).maybeSingle();
        if(existing?.user_id) {
          await sb.from("user_profiles").update({
            plan: userPlan, primary_role: userRole, company_name,
            onboarded: false, updated_at: new Date().toISOString()
          }).eq("user_id", existing.user_id);
          return res.status(200).json({ ok: true, note: "existing user — will re-agree to terms on next login" });
        }
      }
      return res.status(400).json({ error: inviteErr.message });
    }

    const uid = inviteData?.user?.id;

    // Pre-create profile with onboarded:false — they complete it via onboarding
    if(uid) {
      await sb.from("user_profiles").upsert({
        user_id:      uid,
        email,
        company_name,
        plan:         userPlan,
        primary_role: userRole,
        onboarded:    false,        // ← must go through legal agreement
        created_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      }, { onConflict: "user_id" });
    }

    return res.status(200).json({ ok: true, user_id: uid });

  } catch(err) {
    console.error("invite-member error:", err);
    return res.status(500).json({ error: err.message });
  }
}
