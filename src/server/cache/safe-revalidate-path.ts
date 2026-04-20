import { revalidatePath } from "next/cache";

/**
 * `revalidatePath` should not fail the caller if Next.js cache invalidation throws
 * (e.g. edge timing / internal errors). DB work has often already committed.
 */
export function safeRevalidatePath(path: string): void {
  try {
    revalidatePath(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("safe_revalidate_path_failed", { path, error: msg });
  }
}
