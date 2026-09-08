import { z } from "zod";
import { INSTANTPAY_ERRORS } from "../constants/errors";

export const bankAccountValidation = z.object({
  accountNumber: z
    .string({ message: INSTANTPAY_ERRORS.ACCOUNT_NUMBER_REQUIRED })
    .min(1, INSTANTPAY_ERRORS.ACCOUNT_NUMBER_REQUIRED)
    .regex(/^\d{9,18}$/, INSTANTPAY_ERRORS.INVALID_ACCOUNT_FORMAT),
  bankIfsc: z
    .string({ message: INSTANTPAY_ERRORS.IFSC_REQUIRED })
    .min(1, INSTANTPAY_ERRORS.IFSC_REQUIRED)
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, INSTANTPAY_ERRORS.INVALID_IFSC_FORMAT),
  name: z.string().optional(),
});

export type BankAccountValidationInput = z.infer<typeof bankAccountValidation>;
