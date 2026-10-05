import { describe, expect, it } from "vitest";
import { monthlyOpenApiPath } from "./openapi";

describe("Monthly OpenAPI signing guidance", () => {
  it("binds wallet proof guidance to the selected quote network rather than a fixed testnet", () => {
    const schema = monthlyOpenApiPath.patch.requestBody.content["application/json"].schema;
    expect(schema.properties.proof.required).toEqual(["payer", "timestamp", "signature"]);
    const guidance = schema.properties.proof.properties.signature.description;
    expect(guidance).toContain("action/payload, host and selected payment network domain");
    expect(guidance).toContain("network in the current quote before signing");
    expect(JSON.stringify(monthlyOpenApiPath)).not.toMatch(/Arc-testnet|eip155:5042002/);
    expect(monthlyOpenApiPath.post.security).toEqual([{ X402Payment: [] }]);
  });
});
