/**
 * Normalises a raw phone input to E.164 format (+91XXXXXXXXXX).
 * Accepts: "9876543210" (10 digits) or "+919876543210" or "919876543210" (12 digits).
 * Country code defaults to "91" (India).
 */
export function normalizePhone(
  raw: string,
  defaultCountryCode = "91"
): { phone: string; countryCode: string; phoneNumber: string } {
  const cleaned = raw.replace(/\D/g, ""); // strip all non-digits

  let phoneNumber: string;
  if (cleaned.length === 12 && cleaned.startsWith(defaultCountryCode)) {
    // e.g. "919876543210" → "9876543210"
    phoneNumber = cleaned.slice(defaultCountryCode.length);
  } else {
    // take last 10 digits (covers both "9876543210" and any other input)
    phoneNumber = cleaned.slice(-10);
  }

  return {
    phone: `+${defaultCountryCode}${phoneNumber}`,  // full E.164: "+919876543210"
    countryCode: defaultCountryCode,                 // "91"
    phoneNumber,                                      // "9876543210"
  };
}
