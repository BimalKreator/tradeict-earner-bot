/**
 * Keys stored in `profile_change_requests.changes_json` and applied to `users` on approve.
 */
export const PROFILE_CHANGE_FIELD_KEYS = [
  "name",
  "address",
  "phone",
  "whatsapp_number",
  "email",
] as const;

export type ProfileChangeFieldKey = (typeof PROFILE_CHANGE_FIELD_KEYS)[number];

export type ProfileChangesJson = Partial<
  Record<ProfileChangeFieldKey, { old: string | null; new: string | null }>
>;

export const PROFILE_FIELD_LABELS: Record<ProfileChangeFieldKey, string> = {
  name: "Name",
  address: "Address",
  phone: "Mobile",
  whatsapp_number: "WhatsApp",
  email: "Email",
};

/** Shown after a successful profile change request submission. */
export const PROFILE_REQUEST_SUBMITTED_HI =
  "Aapka update admin review ke liye bhej diya gaya hai.";
