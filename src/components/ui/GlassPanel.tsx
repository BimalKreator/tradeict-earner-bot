import type { HTMLAttributes } from "react";

/**
 * Primary surface for cards and sections inside user/admin panels.
 */
export function GlassPanel({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`glass-panel rounded-2xl p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}
