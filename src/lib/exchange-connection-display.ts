export type ExchangeConnectionUiStatus =
  | "not_configured"
  | "disabled"
  | "not_tested"
  | "connected"
  | "invalid"
  | "permission_issue"
  | "failed"
  | "error_state";

const LABELS: Record<ExchangeConnectionUiStatus, string> = {
  not_configured: "Not configured",
  disabled: "Disabled (toggle off)",
  not_tested: "Not tested",
  connected: "Connected",
  invalid: "Invalid credentials",
  permission_issue: "Permission issue",
  failed: "Test failed",
  error_state: "Connection error",
};

export type ExchangeConnectionDisplayInput = {
  status: string;
  hasStoredCredentials: boolean;
  lastTestStatus: string;
  lastTestAt: Date | null;
  lastTestMessage: string | null;
};

export function exchangeConnectionUiLabel(status: ExchangeConnectionUiStatus) {
  return LABELS[status];
}

export function deriveExchangeConnectionUiStatus(
  row: ExchangeConnectionDisplayInput | null,
): { ui: ExchangeConnectionUiStatus; detail: string | null } {
  if (!row) {
    return { ui: "not_configured", detail: null };
  }

  if (row.status === "disabled_user" || row.status === "disabled_admin") {
    return {
      ui: "disabled",
      detail:
        row.status === "disabled_admin"
          ? "Disabled by administrator"
          : "Turned off in your settings",
    };
  }

  if (row.status === "error") {
    return { ui: "error_state", detail: row.lastTestMessage };
  }

  if (!row.hasStoredCredentials) {
    return { ui: "not_configured", detail: null };
  }

  if (row.lastTestStatus === "success") {
    return { ui: "connected", detail: row.lastTestMessage };
  }

  if (row.lastTestStatus === "invalid_credentials") {
    return { ui: "invalid", detail: row.lastTestMessage };
  }

  if (row.lastTestStatus === "permission_denied") {
    return { ui: "permission_issue", detail: row.lastTestMessage };
  }

  if (row.lastTestStatus === "failure") {
    return { ui: "failed", detail: row.lastTestMessage };
  }

  return { ui: "not_tested", detail: row.lastTestMessage };
}
