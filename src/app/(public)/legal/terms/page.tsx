import { redirect } from "next/navigation";

/** Alias URL — single source of truth is `/terms`. */
export default function LegalTermsAliasPage() {
  redirect("/terms");
}
