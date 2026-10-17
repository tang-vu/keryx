/** Versioned release selectors; desktop manifests bind the complete artifact source. */
import application from "../package.json";
import operator from "../desktop/package.json";
import mcp from "../mcp/package.json";

export const releaseVersion = application.version;
export const operatorVersion = operator.version;
const release = "https://github.com/tang-vu/keryx/releases";
const operatorRelease = `${release}/tag/v${releaseVersion}`;
export const installationLinks = Object.freeze({
  release: operatorRelease,
  installer: operatorRelease,
  portable: operatorRelease,
  checksums: operatorRelease,
  manifest: operatorRelease,
  extensionSource: `${release}/download/extension-v0.1.4.3/keryx-extension-v0.1.4.3.zip`,
  extensionStore: "https://chromewebstore.google.com/detail/ofhhhbkpdemcngolfgkjkmkjdilhgjmd",
  webview: "https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section",
  docs: "https://github.com/tang-vu/keryx/blob/main/docs/",
  npm: "https://www.npmjs.com/package/keryx-mcp",
  telegram: "https://t.me/keryxai_bot",
  discord: "https://discord.com/oauth2/authorize?client_id=1527619548809924678",
});

export const setupExamples = Object.freeze({
  apiBase: "https://keryx.cc/api/v1",
  model: "keryx",
  remoteEndpoint: "https://keryx.cc/mcp",
  stdio: JSON.stringify({ mcpServers: { keryx: { command: "npx", args: ["-y", `${mcp.name}@${mcp.version}`] } } }, null, 2),
  models: "curl https://keryx.cc/api/v1/models",
  chat: `curl https://keryx.cc/api/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer keryx" \\\n  -d '{"model":"keryx","messages":[{"role":"user","content":"How do source tolls differ from citation rewards?"}],"stream":true}'`,
  cli: `git clone https://github.com/tang-vu/keryx.git\ncd keryx\nnpm install --global npm@11.19.0\nnpm install\nnpm run operator -- --help\nnpm run buyer -- --help`,
});
