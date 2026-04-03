import { LoginForm } from "@/components/public/LoginForm";

export const metadata = {
  title: "Login",
};

type Props = {
  searchParams?: Promise<{ next?: string; error?: string; reset?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const next = sp.next && sp.next.startsWith("/") ? sp.next : "/user/dashboard";
  const queryError = sp.error ?? null;
  const resetOk = sp.reset === "1";

  const showDevStub =
    process.env.NODE_ENV !== "production" ||
    process.env.AUTH_PHASE1_ALLOW_STUB === "true";

  return (
    <LoginForm
      nextPath={next}
      queryError={queryError}
      resetOk={resetOk}
      showDevStub={showDevStub}
    />
  );
}
