import { z } from "zod";

const indianPincode = /^[1-9][0-9]{5}$/;
const indianMobile = /^[6-9][0-9]{9}$/;

export const addressSchema = z
  .object({
    label: z.enum(["Home", "Work", "Other"]),
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().regex(indianMobile, "Enter a valid 10-digit mobile number."),
    line1: z.string().trim().min(1).max(120), // house / flat
    line2: z.string().trim().min(1).max(160), // street
    area: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    pincode: z.string().trim().regex(indianPincode, "Enter a valid 6-digit PIN code."),
    landmark: z.string().trim().max(120).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict(); // unexpected fields (userId, role, id...) are REJECTED, not ignored

export const addressUpdateSchema = addressSchema.partial();

export const ADDRESS_ALLOWED_FIELDS = [
  "label", "name", "phone", "line1", "line2", "area", "city", "state", "pincode", "landmark", "isDefault",
] as const;
