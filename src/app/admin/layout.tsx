/**
 * Root admin segment: child route groups choose layout — (auth) for login, (panel) for shell.
 */
export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
