/** Known application secrets are defined as empty so Next dotenv cannot refill them during an isolated build. */
export const BUILD_MASKED_ENVIRONMENT: readonly string[] = Object.freeze(`
AGENT_FUNDER_PRIVATE_KEY
BUYER_PRIVATE_KEY
DEPLOYER_PRIVATE_KEY
KERYX_PRIVATE_TREASURY_PRIVATE_KEY
KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
CONTENT_MASTER_KEY
PINATA_JWT
ANTHROPIC_API_KEY
DEEPSEEK_API_KEY
MIMO_API_KEY
OPENAI_API_KEY
KERYX_EMBEDDING_API_KEY
JWT_SECRET
KERYX_BOT_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
SLACK_SIGNING_SECRET
KERYX_SOURCE_UPKEEP_TOKEN
SELLER_ADDRESS
KERYX_PRIVATE_RESULT_SPOOL_KEY
KERYX_PRIVATE_PROVIDER_API_KEY
KERYX_BACKUP_ENCRYPTION_KEY
KERYX_R2_ACCESS_KEY_ID
KERYX_R2_SECRET_ACCESS_KEY
KERYX_BUYER_PRIVATE_KEY
`.trim().split(/\s+/));

/** Preserve only public process/build settings, not arbitrary inherited credentials or NODE_OPTIONS loaders. */
export function isolatedOfflineBuildEnvironment(manifestPath: string, databasePath: string,
  inherited: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE",
    "COMSPEC", "PATHEXT", "NEXT_DIST_DIR", "KERYX_COMMIT", "CI", "FORCE_COLOR", "NO_COLOR"]) {
    if (inherited[name] !== undefined) env[name] = inherited[name];
  }
  if (inherited.NODE_OPTIONS) {
    if (!/^--max-old-space-size=(?:[1-9][0-9]{2,4})$/.test(inherited.NODE_OPTIONS)) throw new Error("Unsupported isolated build memory configuration");
    env.NODE_OPTIONS = inherited.NODE_OPTIONS;
  }
  for (const name of BUILD_MASKED_ENVIRONMENT) env[name] = "";
  env.KERYX_STORAGE_MANIFEST = manifestPath; env.KERYX_SQLITE_PATH = databasePath;
  env.KERYX_FORCE_OFFLINE = "1"; env.KERYX_PRIVATE_RESEARCH_ENABLED = "0";
  env.KERYX_PRIVATE_WORKER_ENABLED = "0"; env.KERYX_PRIVATE_PURCHASE_ENABLED = "0";
  env.KERYX_WITHDRAWAL_RELAY_ENABLED = "0"; env.KERYX_WITHDRAWAL_HTTP_ENABLED = "0";
  env.KERYX_BROWSER_AUTHORIZATION_PAUSED = "1"; env.NEXT_TELEMETRY_DISABLED = "1";
  return env;
}
