const APP_NAME = Deno.env.get("APP_NAME") ?? "ASguIDE";
const ADMIN_NOTIFICATION_EMAIL = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const SIGNUP_WEBHOOK_SECRET = Deno.env.get("SIGNUP_WEBHOOK_SECRET") ?? "";
const ADMIN_REVIEW_URL = Deno.env.get("ADMIN_REVIEW_URL") ?? "";

type ProfileRecord = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  approved: boolean | null;
  status: string | null;
  created_at?: string | null;
};

type DatabaseWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: ProfileRecord | null;
  old_record?: ProfileRecord | null;
};

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

function getRequestedAt(record: ProfileRecord) {
  const isoValue = record.created_at || new Date().toISOString();
  const parsedDate = new Date(isoValue);

  return {
    iso: parsedDate.toISOString(),
    fr: new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "full",
      timeStyle: "medium",
      timeZone: "Europe/Paris"
    }).format(parsedDate)
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailContent(record: ProfileRecord) {
  const requestedAt = getRequestedAt(record);
  const firstName = record.first_name?.trim() || "Non renseigné";
  const lastName = record.last_name?.trim() || "Non renseigné";
  const email = record.email?.trim() || "Non renseigné";
  const status = record.status?.trim() || "pending";
  const approvalText = record.approved ? "Oui" : "Non";
  const reviewBlock = ADMIN_REVIEW_URL
    ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(ADMIN_REVIEW_URL)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;">Ouvrir l'administration</a></p>`
    : "";

  const subject = `[${APP_NAME}] Nouvelle demande d'accès`;

  const text = [
    `Nouvelle inscription sur ${APP_NAME}.`,
    "",
    `Prénom : ${firstName}`,
    `Nom : ${lastName}`,
    `Email : ${email}`,
    `Date/heure de la demande : ${requestedAt.fr} (${requestedAt.iso})`,
    `Statut : ${status}`,
    `Approved : ${approvalText}`,
    "",
    "Le compte est en attente de validation."
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#12232f;padding:24px;background:#f8fcfb;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9e5e4;border-radius:20px;padding:28px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;">${escapeHtml(APP_NAME)}</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;">Nouvelle demande d'accès</h1>
        <p style="margin:0 0 20px;color:#58707d;">Un nouveau compte vient d'être créé et attend votre validation.</p>

        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;border-top:1px solid #e5efee;font-weight:700;">Prénom</td>
            <td style="padding:10px 0;border-top:1px solid #e5efee;">${escapeHtml(firstName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #e5efee;font-weight:700;">Nom</td>
            <td style="padding:10px 0;border-top:1px solid #e5efee;">${escapeHtml(lastName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #e5efee;font-weight:700;">Email</td>
            <td style="padding:10px 0;border-top:1px solid #e5efee;">${escapeHtml(email)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #e5efee;font-weight:700;">Date/heure</td>
            <td style="padding:10px 0;border-top:1px solid #e5efee;">${escapeHtml(requestedAt.fr)}<br><span style="color:#58707d;font-size:12px;">${escapeHtml(requestedAt.iso)}</span></td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #e5efee;font-weight:700;">Statut</td>
            <td style="padding:10px 0;border-top:1px solid #e5efee;">${escapeHtml(status)} / approved = ${escapeHtml(approvalText)}</td>
          </tr>
        </table>

        <div style="margin-top:20px;padding:16px 18px;background:#ecfdf5;border-radius:16px;color:#115e59;font-weight:700;">
          Le compte est en attente de validation.
        </div>
        ${reviewBlock}
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function sendEmail(record: ProfileRecord) {
  if (!ADMIN_NOTIFICATION_EMAIL || !RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("Variables d'environnement email manquantes.");
  }

  const { subject, html, text } = buildEmailContent(record);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `new-signup-${record.id}`
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [ADMIN_NOTIFICATION_EMAIL],
      subject,
      html,
      text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend error ${response.status}: ${errorText}`);
  }

  return response.json();
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return Response.json({ ok: true, function: "notify-admin-new-signup" });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const receivedSecret = request.headers.get("x-webhook-secret") ?? "";

  if (!SIGNUP_WEBHOOK_SECRET || !constantTimeEqual(receivedSecret, SIGNUP_WEBHOOK_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as DatabaseWebhookPayload;
    const record = payload.record;

    if (payload.type !== "INSERT" || payload.schema !== "public" || payload.table !== "profiles" || !record) {
      return Response.json({ ok: true, ignored: true });
    }

    await sendEmail(record);

    return Response.json({ ok: true });
  } catch (error) {
    console.error("notify-admin-new-signup failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
});
