import { z } from "zod";

export const verifyPanSchema = z.object({
  pan: z
    .string()
    .min(10, "PAN must be exactly 10 characters")
    .max(10, "PAN must be exactly 10 characters")
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format. Example: ABCDE1234F")
    .transform((val) => val.toUpperCase()),
});
