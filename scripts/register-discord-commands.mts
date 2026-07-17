/**
 * register-discord-commands.mts — register (or update) Keryx's slash commands with Discord.
 *
 * Pushes the /ask command definition to the Discord application. Global by default (Discord may
 * take up to ~1h to propagate a global command); pass --guild <id> to register instantly on one
 * server while testing. Safe to re-run: Discord upserts commands by name.
 *
 * Run:  npm run register-discord            (global)
 *       npm run register-discord -- --guild 123456789012345678
 * Env:  DISCORD_APP_ID + DISCORD_BOT_TOKEN  (Developer Portal; token used only here, never by the app)
 */

import { config } from "../lib/config.ts";

const appId = process.env.DISCORD_APP_ID ?? "";
const botToken = process.env.DISCORD_BOT_TOKEN ?? "";
if (!appId || !botToken) {
  console.error("DISCORD_APP_ID and DISCORD_BOT_TOKEN are required (see docs/discord-bot-setup.md).");
  process.exit(1);
}

const guildFlag = process.argv.indexOf("--guild");
const guildId = guildFlag !== -1 ? process.argv[guildFlag + 1] : undefined;
if (guildFlag !== -1 && !guildId) {
  console.error("--guild needs a server id, e.g. --guild 123456789012345678");
  process.exit(1);
}

// Option types: 3 = STRING, 10 = NUMBER. max_length keeps questions inside embed-title territory.
const commands = [
  {
    name: "ask",
    description: "Ask Keryx — it buys the right paid sources and pays every cited creator in USDC",
    options: [
      {
        type: 3,
        name: "question",
        description: "What do you want to know?",
        required: true,
        max_length: 400,
      },
      {
        type: 10,
        name: "budget",
        description: `Max USDC to spend (server clamps to ${config.anonMaxBudget})`,
        required: false,
        min_value: 0.001,
        max_value: 1,
      },
    ],
  },
];

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`Discord rejected the registration: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const registered = (await res.json()) as { name: string; id: string }[];
for (const c of registered) console.log(`registered /${c.name} (${c.id})`);
console.log(
  guildId
    ? `Scope: guild ${guildId} (instant).`
    : "Scope: global (Discord may take up to ~1h to propagate).",
);
