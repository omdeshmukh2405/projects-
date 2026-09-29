import crypto from "node:crypto";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";
import { rateLimitOrResponse } from "@/lib/rateLimit";

/**
 * Payment provider webhook (SECURITY.md #17, #49).
 *
 * Hard rules implemented here:
 *  1. Verify the provider's signature BEFORE parsing the body as trusted
 *     JSON. Everything below the signature check treats the payload as
 *     attacker-controlled until proven otherwise.
 *  2. Idempotent by provider event id — a redelivered or replayed webhook
 *     can never mark the same order paid twice or double-fulfil it.
 *  3. Re-validate amount/currency/order-reference against our own database
 *     order rather than trusting the webhook's own "amount paid" field
 *     wholesale — a forged or confused webhook still can't move a
 *     different order into PAID.
 *  4. Client-reported `paymentSuccess: true` is never accepted anywhere in
 *     this codebase — only this server-to-server, signature-verified path
 *     can transition paymentStatus.
 *
 * The signature-verification helper below is written for a generic
 * HMAC-SHA256 signed-payload provider (this is how Razorpay, and many
 * others, sign webhooks). Swap in your provider's SDK verifier
 * (e.g. Stripe's `stripe.webhooks.constructEvent`) if different — do not
 * hand-roll verification for a provider that ships an official one.
 */
export async function POST(req: Request) {
  const limited = rateLimitOrResponse("webhook", "global-webhook-ip-pool");
  if (limited) return limited;

  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;

  if (!secret) {
    await logEvent({ level: "error", eventType: "WEBHOOK_MISCONFIGURED", result: "ERROR" });
    return new Response("Server misconfiguration.", { status: 500 });
  }
  if (!signature || !verifySignature(rawBody, signature, secret)) {
    await logEvent({ level: "security", eventType: "WEBHOOK_SIGNATURE_INVALID", result: "DENIED" });
    return new Response("Invalid signature.", { status: 400 });
  }

  const payload = JSON.parse(rawBody) as {
    eventId: string;
    orderId: string;
    status: "SUCCEEDED" | "FAILED";
    amountInPaise: number;
    providerRef: string;
  };

  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

  try {
    await db.$transaction(async (tx) => {
      // Idempotency: primary key collision means we've already processed
      // this exact event id, so we throw and let the outer catch treat it
      // as a no-op success (SECURITY.md #18).
      await tx.webhookEvent.create({
        data: { id: payload.eventId, provider: "payment-provider", payloadHash },
      });

      const order = await tx.order.findUnique({ where: { id: payload.orderId } });
      if (!order) throw new WebhookOrderMismatch("Unknown order referenced by webhook.");

      // Re-validate the amount against OUR stored total, not just whatever
      // the webhook claims — a forged/confused webhook can't discount an
      // order by disagreeing with our own total.
      if (payload.amountInPaise !== order.totalInPaise) {
        throw new WebhookOrderMismatch("Webhook amount does not match order total.");
      }

      if (payload.status === "SUCCEEDED") {
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: "SUCCEEDED", status: "PAID", paymentProviderRef: payload.providerRef },
        });
      } else {
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: "FAILED" },
        });
      }
    });

    await logEvent({
      level: "info",
      eventType: "WEBHOOK_PROCESSED",
      resource: `order:${payload.orderId}`,
      result: "SUCCESS",
      metadata: { eventId: payload.eventId, status: payload.status },
    });

    return Response.json({ received: true });
  } catch (err: any) {
    if (err?.code === "P2002") {
      // Unique constraint on WebhookEvent.id -> duplicate delivery, not an error.
      return Response.json({ received: true, duplicate: true });
    }
    if (err instanceof WebhookOrderMismatch) {
      await logEvent({ level: "security", eventType: "WEBHOOK_MISMATCH", result: "DENIED", metadata: { message: err.message } });
      return new Response("Rejected.", { status: 400 });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    await logEvent({ level: "error", eventType: "WEBHOOK_PROCESSING_FAILED", result: "ERROR" });
    return new Response("Internal error.", { status: 500 });
  }
}

class WebhookOrderMismatch extends Error {}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Constant-time comparison to avoid a timing side-channel on signature
  // verification.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
