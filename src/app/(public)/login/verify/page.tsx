import { VerifyLoginForm } from "@/components/public/VerifyLoginForm";

export const metadata = {
  title: "Verify email code",
};

type Props = { searchParams?: Promise<{ next?: string }> };

export default async function LoginVerifyPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const next = sp.next && sp.next.startsWith("/") ? sp.next : "/user/dashboard";

  return <VerifyLoginForm nextPath={next} />;
}
