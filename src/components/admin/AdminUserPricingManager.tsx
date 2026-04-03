"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { formatInrAmount } from "@/lib/format-inr";
import {
  adminCreatePricingOverrideFormAction,
  adminDeletePricingOverrideFormAction,
  adminUpdatePricingOverrideFormAction,
  type AdminPricingOverrideFormState,
} from "@/server/actions/adminPricingOverrides";
import type { AdminPricingStrategyOption } from "@/server/queries/admin-user-pricing";

export type SerializedPricingOverride = {
  id: string;
  strategyId: string;
  strategyName: string;
  strategySlug: string;
  monthlyFeeInrOverride: string | null;
  revenueSharePercentOverride: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
  adminNotes: string | null;
  createdAt: string;
};

function Msg({ s }: { s: AdminPricingOverrideFormState }) {
  if (!s) return null;
  return s.ok ? (
    <p className="text-xs text-emerald-400/90">{s.message}</p>
  ) : (
    <p className="text-xs text-red-400/90">{s.message}</p>
  );
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminUserPricingManager(props: {
  targetUserId: string;
  userEmail: string;
  overrides: SerializedPricingOverride[];
  strategyOptions: AdminPricingStrategyOption[];
}) {
  const { targetUserId, userEmail, overrides, strategyOptions } = props;
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<SerializedPricingOverride | null>(null);

  const [createState, createAction, createPending] = useActionState(
    adminCreatePricingOverrideFormAction,
    null,
  );
  const [updateState, updateAction, updatePending] = useActionState(
    adminUpdatePricingOverrideFormAction,
    null,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    adminDeletePricingOverrideFormAction,
    null,
  );

  useEffect(() => {
    if (createState?.ok) {
      router.refresh();
      setAddOpen(false);
    }
  }, [createState, router]);

  useEffect(() => {
    if (updateState?.ok) {
      router.refresh();
      setEditRow(null);
    }
  }, [updateState, router]);

  useEffect(() => {
    if (deleteState?.ok) router.refresh();
  }, [deleteState, router]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/admin/users/${targetUserId}`}
            className="text-xs font-medium text-[var(--accent)] hover:underline"
          >
            Back to user
          </Link>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{userEmail}</p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"
        >
          Add override
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Overrides are per strategy. Only one active window covers a moment in time;
        a new active row closes the previous open window at the same effective-from
        instant. Weekly ledgers keep the percent stored when they were generated.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-[var(--border-glass)] text-[10px] uppercase tracking-wide text-[var(--text-muted)] sm:text-xs">
              <th className="pb-2 pr-3 font-medium">Strategy</th>
              <th className="pb-2 pr-3 font-medium">Fee / Rev %</th>
              <th className="pb-2 pr-3 font-medium">Window</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Notes</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {overrides.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-[var(--text-muted)]">
                  No overrides yet.
                </td>
              </tr>
            ) : (
              overrides.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border-glass)]/60 text-[var(--text-primary)]"
                >
                  <td className="py-2 pr-3">
                    <span className="font-medium">{r.strategyName}</span>
                    <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">
                      {r.strategySlug}
                    </span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-[var(--text-muted)]">
                    {r.monthlyFeeInrOverride
                      ? formatInrAmount(r.monthlyFeeInrOverride)
                      : "—"}{" "}
                    ·{" "}
                    {r.revenueSharePercentOverride
                      ? `${r.revenueSharePercentOverride}%`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-[var(--text-muted)]">
                    <div className="max-w-[200px] leading-snug">
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "Asia/Kolkata",
                      }).format(new Date(r.effectiveFrom))}
                      {" → "}
                      {r.effectiveUntil
                        ? new Intl.DateTimeFormat("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: "Asia/Kolkata",
                          }).format(new Date(r.effectiveUntil))
                        : "open"}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {r.isActive ? (
                      <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-md bg-slate-500/20 px-1.5 py-0.5 text-[10px] text-slate-300">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td
                    className="max-w-[160px] truncate py-2 pr-3 text-[var(--text-muted)]"
                    title={r.adminNotes ?? ""}
                  >
                    {r.adminNotes ? `${r.adminNotes.slice(0, 40)}` : "—"}
                  </td>
                  <td className="py-2 align-top">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditRow(r)}
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        Edit
                      </button>
                      <form action={deleteAction} className="inline">
                        <input type="hidden" name="targetUserId" value={targetUserId} />
                        <input type="hidden" name="overrideId" value={r.id} />
                        <button
                          type="submit"
                          disabled={deletePending}
                          className="text-xs font-semibold text-red-400/90 hover:underline disabled:opacity-50"
                          onClick={(e) => {
                            if (!window.confirm("Delete this override?")) {
                              e.preventDefault();
                            }
                          }}
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Msg s={deleteState} />

      {addOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border-glass)] bg-[#0a0c12] p-5 shadow-xl">
            <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--text-primary)]">
              Add pricing override
            </h3>
            <form action={createAction} className="mt-4 space-y-3">
              <input type="hidden" name="targetUserId" value={targetUserId} />
              <label className="block text-xs text-[var(--text-muted)]">
                Strategy
                <select
                  name="strategyId"
                  required
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  <option value="">Select</option>
                  {strategyOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.slug})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Monthly fee (INR), optional if you set %
                <input
                  name="monthlyFeeInr"
                  type="text"
                  inputMode="decimal"
                  placeholder="999"
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Revenue share % override
                <input
                  name="revenueSharePercent"
                  type="text"
                  inputMode="decimal"
                  placeholder="15"
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Effective from (empty = now)
                <input
                  name="effectiveFrom"
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
                <input type="checkbox" name="isActive" defaultChecked className="rounded" />
                Active
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Admin notes
                <textarea
                  name="adminNotes"
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={createPending}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {createPending ? "Saving" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="rounded-lg border border-[var(--border-glass)] px-4 py-2 text-sm text-[var(--text-muted)]"
                >
                  Cancel
                </button>
              </div>
              <Msg s={createState} />
            </form>
          </div>
        </div>
      ) : null}

      {editRow ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditRow(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border-glass)] bg-[#0a0c12] p-5 shadow-xl">
            <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--text-primary)]">
              Edit: {editRow.strategyName}
            </h3>
            <form key={editRow.id} action={updateAction} className="mt-4 space-y-3">
              <input type="hidden" name="targetUserId" value={targetUserId} />
              <input type="hidden" name="overrideId" value={editRow.id} />
              <label className="block text-xs text-[var(--text-muted)]">
                Monthly fee (INR)
                <input
                  name="monthlyFeeInr"
                  type="text"
                  defaultValue={editRow.monthlyFeeInrOverride ?? ""}
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Revenue share %
                <input
                  name="revenueSharePercent"
                  type="text"
                  defaultValue={editRow.revenueSharePercentOverride ?? ""}
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Effective until (empty = open)
                <input
                  name="effectiveUntil"
                  type="datetime-local"
                  defaultValue={
                    editRow.effectiveUntil
                      ? toDatetimeLocalValue(editRow.effectiveUntil)
                      : ""
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={editRow.isActive}
                  className="rounded"
                />
                Active
              </label>
              <label className="block text-xs text-[var(--text-muted)]">
                Admin notes
                <textarea
                  name="adminNotes"
                  rows={2}
                  defaultValue={editRow.adminNotes ?? ""}
                  className="mt-1 w-full rounded-lg border border-[var(--border-glass)] bg-black/40 px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={updatePending}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {updatePending ? "Saving" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditRow(null)}
                  className="rounded-lg border border-[var(--border-glass)] px-4 py-2 text-sm text-[var(--text-muted)]"
                >
                  Cancel
                </button>
              </div>
              <Msg s={updateState} />
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
