import Link from "next/link";
import { eq } from "drizzle-orm";

import { UserProfileChangeForm } from "@/components/user/UserProfileChangeForm";
import { UserProfilePasswordForm } from "@/components/user/UserProfilePasswordForm";
import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  PROFILE_FIELD_LABELS,
  type ProfileChangeFieldKey,
} from "@/lib/profile-change-fields";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { getUserProfileChangeRequests } from "@/server/queries/profile-change-requests";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profile",
};

function fmtIst(d: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export default async function UserProfilePage() {
  const userId = await requireUserIdForPage("/user/profile");
  if (!userId) {
    return (
      <div className="space-y-6">
        <GlassPanel>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
            Profile
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Sign in with your user account to view and edit your profile.
          </p>
          <Link
            href="/login?next=%2Fuser%2Fprofile"
            className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            Go to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  if (!db) {
    return (
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">
          Database is not configured.
        </p>
      </GlassPanel>
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.deletedAt) {
    return (
      <GlassPanel>
        <p className="text-sm text-red-300">Account not found.</p>
      </GlassPanel>
    );
  }

  const requests = await getUserProfileChangeRequests(userId);
  const hasPending = requests.some((r) => r.status === "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Profile
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Live account details, password, and requests waiting for admin review.
        </p>
      </div>

      <GlassPanel className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Current profile (live)
        </h2>
        <dl className="grid gap-3 text-sm text-[var(--text-muted)] sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Name
            </dt>
            <dd className="mt-0.5 text-[var(--text-primary)]">
              {user.name ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Email
            </dt>
            <dd className="mt-0.5 text-[var(--text-primary)]">{user.email}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Address
            </dt>
            <dd className="mt-0.5 text-[var(--text-primary)]">
              {user.address ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Mobile
            </dt>
            <dd className="mt-0.5 text-[var(--text-primary)]">
              {user.phone ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              WhatsApp
            </dt>
            <dd className="mt-0.5 text-[var(--text-primary)]">
              {user.whatsappNumber ?? "—"}
            </dd>
          </div>
        </dl>
      </GlassPanel>

      <UserProfileChangeForm
        user={{
          name: user.name,
          address: user.address,
          phone: user.phone,
          whatsappNumber: user.whatsappNumber,
          email: user.email,
        }}
        hasPendingRequest={hasPending}
      />

      <UserProfilePasswordForm />

      <GlassPanel className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Your change requests
        </h2>
        {requests.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No requests yet.</p>
        ) : (
          <ul className="space-y-4">
            {requests.map((r) => {
              const ch = r.changesJson as Record<
                string,
                { old: unknown; new: unknown }
              >;
              const keys = Object.keys(ch) as ProfileChangeFieldKey[];
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-[var(--border-glass)] bg-black/20 p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
                        r.status === "pending"
                          ? "bg-amber-500/15 text-amber-100"
                          : r.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-100"
                            : "bg-red-500/15 text-red-100"
                      }`}
                    >
                      {r.status}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {fmtIst(r.createdAt)} IST
                    </span>
                  </div>
                  {r.status === "rejected" && r.reviewNote ? (
                    <p className="mt-2 text-xs text-amber-100/90">
                      Admin note: {r.reviewNote}
                    </p>
                  ) : null}
                  <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
                    {keys.map((k) => {
                      const label = PROFILE_FIELD_LABELS[k] ?? k;
                      const row = ch[k];
                      if (!row) return null;
                      return (
                        <li key={k}>
                          <span className="text-[var(--text-primary)]">
                            {label}:
                          </span>{" "}
                          {String(row.old ?? "—")} → {String(row.new ?? "—")}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}
