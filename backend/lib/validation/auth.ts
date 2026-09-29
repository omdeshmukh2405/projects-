import { z } from "zod";

// Password policy: length + character-class diversity, aligned with
// ASVS 5.0 memorized-secret requirements (min 12 chars rather than the older
// 8-char guidance). We deliberately do NOT require periodic rotation —
// that's an outdated practice ASVS 5.0 and NIST 800-63B both drop.
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password is too long.")
  .refine((v) => /[a-z]/.test(v), "Include a lowercase letter.")
  .refine((v) => /[A-Z]/.test(v), "Include an uppercase letter.")
  .refine((v) => /[0-9]/.test(v), "Include a number.")
  .refine((v) => /[^a-zA-Z0-9]/.test(v), "Include a symbol.");

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});
