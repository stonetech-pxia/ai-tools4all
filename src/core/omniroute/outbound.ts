// Environment switches that stop OmniRoute's own outbound traffic, so that
// without the dashboard open it only talks to the AI services the user
// connected. From an audit of OmniRoute 3.8.52's source. The server starts
// from an allow-listed environment (see buildServerEnv), so cloud sync and
// OpenTelemetry endpoints can't be inherited from the user's shell.
//
// Not switchable without patching OmniRoute (documented in the README):
// the dashboard's update/news checks and flag icons, and OpenRouter's public
// model catalog fetched for /v1/models while an OpenRouter connection exists.
export const OUTBOUND_OFF: Record<string, string> = {
  // Hourly test of every connected key (also spends free-tier quota).
  OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK: "true",
  OMNIROUTE_DISABLE_CONNECTION_RECOVERY: "true",
  // Pinning the version skips an npm registry lookup made when request
  // executors load.
  CLAUDE_CODE_CLIENT_VERSION: "2.1.280",
  // Already off with OMNIROUTE_DISABLE_BACKGROUND_SERVICES or by default;
  // kept explicit so a future default change can't turn them on.
  OPENROUTER_PROVIDER_STATS_ENABLED: "false",
  ARENA_ELO_SYNC_ENABLED: "false",
  PRICING_SYNC_ENABLED: "false",
  MODELS_DEV_SYNC_ENABLED: "false",
  PROXY_HEALTH_ENABLED: "false",
};
