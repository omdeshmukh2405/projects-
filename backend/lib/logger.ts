import { db } from "./db";

/**
 * Structured, security-conscious logging.
 *
 * Rules (see SECURITY.md #55 / #37):
 *  - NEVER pass passwords, tokens, session ids, card data or full addresses
 *    into `metadata`. Callers are responsible for this; this module does not
 *    attempt to guess and redact secrets after the fact.
 *  - Every security-sensitive action gets an AuditLog row in addition to the
 *    console/stdout line, so it survives independent of log aggregation.
 */

type Level = "info" | "warn" | "security" | "error";

interface LogEvent {
  level: Level;
  eventType: string;
  userId?: string | null;
  resource?: string | null;
  result: "SUCCESS" | "DENIED" | "ERROR";
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logEvent(evt: LogEvent) {
  const line = {
    ts: new Date().toISOString(),
    level: evt.level,
    eventType: evt.eventType,
    userId: evt.userId ?? null,
    resource: evt.resource ?? null,
    result: evt.result,
    ip: evt.ipAddress ?? null,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));

  try {
    await db.auditLog.create({
      data: {
        userId: evt.userId ?? undefined,
        eventType: evt.eventType,
        resource: evt.resource ?? undefined,
        result: evt.result,
        ipAddress: evt.ipAddress ?? undefined,
        metadata: evt.metadata as any,
      },
    });
  } catch {
    // Audit logging must never crash the request. If the DB write fails we
    // still have the stdout line above for aggregation/alerting to pick up.
  }
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return null;
}
