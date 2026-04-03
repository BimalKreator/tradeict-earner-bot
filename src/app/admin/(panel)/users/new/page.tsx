import { CreateUserForm } from "@/components/admin/CreateUserForm";

export const metadata = {
  title: "Add user",
};

export default function AdminNewUserPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Add user
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Manual onboarding with automatic credentials email.
        </p>
      </div>
      <CreateUserForm />
    </div>
  );
}
