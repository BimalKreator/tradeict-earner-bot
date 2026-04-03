import { ForgotPasswordForm } from "@/components/public/ForgotPasswordForm";

export const metadata = {
  title: "Forgot password",
};

type Props = { searchParams?: Promise<{ sent?: string }> };

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const sent = sp.sent === "1";

  return <ForgotPasswordForm sent={sent} />;
}
