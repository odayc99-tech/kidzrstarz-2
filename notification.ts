import { Resend } from "resend";
import { ENV } from "./env";

export type NotificationPayload = {
  title: string;
  content: string;
};

/**
 * Sends an owner notification email via Resend.
 * Returns `true` on success, `false` if Resend is not configured or the
 * request fails (callers should log but not crash).
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  if (!ENV.resendApiKey || !ENV.ownerEmail) {
    // Resend not configured — log to console as fallback
    console.log(`[Notification] ${payload.title}\n${payload.content}`);
    return false;
  }

  try {
    const resend = new Resend(ENV.resendApiKey);
    const { error } = await resend.emails.send({
      from: "KidzRstarz <notifications@kidzrstarz.com>",
      to: ENV.ownerEmail,
      subject: payload.title,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${payload.content}</pre>`,
    });
    if (error) {
      console.warn("[Notification] Resend error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Notification] Failed to send email:", err);
    return false;
  }
}
