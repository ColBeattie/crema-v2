/**
 * Postmark email sending placeholder.
 * When POSTMARK_API_TOKEN is configured, sends real emails.
 * Otherwise, logs a warning and returns success (no-op).
 */

interface EmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n\t]/g, "").trim();
}

export async function sendEmail(
  options: EmailOptions
): Promise<{ success: boolean; error?: string }> {
  const apiToken = process.env.POSTMARK_API_TOKEN;
  const fromEmail = sanitizeEmailHeader(
    process.env.POSTMARK_FROM_EMAIL || "noreply@example.com"
  );
  const to = sanitizeEmailHeader(options.to);
  const subject = sanitizeEmailHeader(options.subject);

  if (!to || !subject) {
    console.error(
      "[Postmark] Invalid email parameters: empty to or subject after sanitization"
    );
    return { success: false, error: "Invalid email parameters" };
  }

  if (!apiToken) {
    console.warn(
      "[Postmark] POSTMARK_API_TOKEN not configured. Email not sent:",
      {
        to,
        subject,
      }
    );
    return { success: true };
  }

  try {
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": apiToken,
      },
      body: JSON.stringify({
        From: fromEmail,
        To: to,
        Subject: subject,
        HtmlBody: options.htmlBody,
        TextBody: options.textBody || "",
        MessageStream: "outbound",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[Postmark] Failed to send email:", errorData);
      return { success: false, error: "Failed to send email" };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error("[Postmark] Error sending email:", error);
    return { success: false, error: "Email service error" };
  }
}
