const path = require("node:path");

/** Only Circle's pinned browser module gets this rewrite; server JWT imports keep
 * their original library. Refuse SDK drift instead of guessing another API surface. */
module.exports = function circleSdkBrowserLoader(source) {
  const calls = [...source.matchAll(/jsonwebtoken_1\.([A-Za-z]+)/g)].map(match => match[1]);
  const imports = [...source.matchAll(/require\(["']jsonwebtoken["']\)/g)];
  if (imports.length !== 1 || calls.length !== 1 || calls[0] !== "decode") {
    throw new Error("Circle Web SDK browser JWT usage changed; review its browser adapter before release");
  }
  const resource = this?.resourcePath ?? require.resolve("@circle-fin/w3s-pw-web-sdk");
  const target = path.resolve(__dirname, "../lib/circle-wallet-jwt-decode.ts");
  let adapter = path.relative(path.dirname(resource), target).replaceAll("\\", "/");
  if (/^[A-Za-z]:/.test(adapter)) throw new Error("Circle browser adapter and SDK must be on the same filesystem volume");
  if (!adapter.startsWith(".")) adapter = `./${adapter}`;
  return source.replace(imports[0][0], `require(${JSON.stringify(adapter)})`);
};
