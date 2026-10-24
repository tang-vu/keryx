import { expect, it } from "vitest";
import { openapiSpec } from "../openapi-spec";

it("documents the wired original-response bearer separately from account or payment authority", () => {
  const path = openapiSpec.paths["/api/research-feedback"];
  expect(Object.keys(path)).toEqual(["post"]);
  expect(path.post.security).toEqual([{ RequesterFeedbackCapability: [] }]);
  expect(openapiSpec.components.securitySchemes.RequesterFeedbackCapability).toMatchObject({ type: "http", scheme: "bearer" });
  expect(path.post.requestBody.content["application/json"].schema.oneOf).toMatchObject([
    { additionalProperties: false, required: ["operation"], properties: { operation: { const: "read" } } },
    { additionalProperties: false, required: ["operation", "choice"], properties: { operation: { const: "submit" } } },
  ]);
  expect(openapiSpec.components.schemas.ChatCompletion.properties.keryx_private_requester)
    .toEqual({ $ref: "#/components/schemas/PrivateRequesterObservations" });
  expect(openapiSpec.components.schemas.RecordedJobObservations.properties.invoice).toEqual({ type: "null" });
  expect(openapiSpec.components.schemas.RecordedJobObservations.properties.profit).toEqual({ type: "null" });
});
