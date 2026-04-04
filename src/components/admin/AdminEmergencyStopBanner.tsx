import Link from "next/link";

export function AdminEmergencyStopBanner({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-100 shadow-lg shadow-rose-950/30">
      <p className="font-semibold tracking-tight">Global emergency stop is ON</p>
      <p className="mt-1 text-xs text-rose-200/90">
        All bot order submissions (entries and exits) are rejected until a super admin
        clears this flag.{" "}
        <Link
          href="/admin/risk"
          className="font-medium text-sky-300 underline decoration-sky-500/50 underline-offset-2 hover:text-sky-200"
        >
          Risk command center
        </Link>
      </p>
    </div>
  );
}
