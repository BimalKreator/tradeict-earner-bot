import Link from "next/link";
import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { AdminUsersPagination } from "@/components/admin/AdminUsersPagination";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import { AdminUsersToolbar } from "@/components/admin/AdminUsersToolbar";
import {
  USER_LIST_FILTER_STATUSES,
  type UserListFilterStatus,
  UserStatusFilter,
} from "@/components/admin/UserStatusFilter";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const metadata = {
  title: "Users",
};

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const ALLOWED_PAGE_SIZES = [10, 20, 50];

function parseStatus(raw: string | undefined): UserListFilterStatus {
  if (!raw) return "all";
  const ok = USER_LIST_FILTER_STATUSES.includes(raw as UserListFilterStatus);
  return ok ? (raw as UserListFilterStatus) : "all";
}

function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  if (ALLOWED_PAGE_SIZES.includes(n)) return n;
  return DEFAULT_PAGE_SIZE;
}

function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

type Props = {
  searchParams?: Promise<{
    status?: string;
    q?: string;
    page?: string;
    pageSize?: string;
  }>;
};

export default async function AdminUsersPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const filter = parseStatus(sp.status);
  const q = (sp.q ?? "").trim();
  const pageSize = parsePageSize(sp.pageSize);
  const page = parsePage(sp.page);

  const userConditions: SQL[] = [isNull(users.deletedAt)];
  if (filter !== "all") {
    userConditions.push(eq(users.approvalStatus, filter));
  }
  if (q) {
    const pat = `%${escapeIlikePattern(q)}%`;
    userConditions.push(
      sql`(${users.email} ilike ${pat} escape '\\' OR coalesce(${users.name}, '') ilike ${pat} escape '\\')`,
    );
  }
  const whereClause = and(...userConditions);

  type UserListRow = {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    approvalStatus: string;
    createdAt: Date;
  };
  let list: UserListRow[] = [];
  let pendingCount = 0;
  let safePage = 1;
  let totalPages = 1;

  if (db != null) {
    const [countRow] = await db
      .select({ c: count() })
      .from(users)
      .where(whereClause);
    const total = Number(countRow?.c ?? 0);
    totalPages = Math.max(1, Math.ceil(total / pageSize));
    safePage = Math.min(page, totalPages);

    const offset = (safePage - 1) * pageSize;
    list = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        phone: users.phone,
        approvalStatus: users.approvalStatus,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [pendingRow] = await db
      .select({ c: count() })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.approvalStatus, "pending_approval"),
        ),
      );
    pendingCount = Number(pendingRow?.c ?? 0);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            Users
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {pendingCount} awaiting approval. Search by email or name; use
            filters and pagination below.
          </p>
        </div>
        <Link
          href="/admin/users/new"
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[var(--accent-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--bg-void)] hover:brightness-110"
        >
          Add user
        </Link>
      </div>
      <GlassPanel className="space-y-4">
        <AdminUsersToolbar
          initialQ={q}
          status={filter}
          pageSize={pageSize}
        />
        <UserStatusFilter current={filter} q={q} pageSize={pageSize} />
        <AdminUsersTable rows={list} />
        <AdminUsersPagination
          page={safePage}
          totalPages={totalPages}
          q={q}
          status={filter}
          pageSize={pageSize}
        />
      </GlassPanel>
    </div>
  );
}
