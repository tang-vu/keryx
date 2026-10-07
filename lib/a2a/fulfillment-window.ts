import { z } from "zod";

export const FULFILLMENT_SUPPLIER_WINDOW_MAX_MS = 5_400_000;
export const fulfillmentTimestampSchema = z.string().datetime().refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

/** Explicit reviewed permission, never a default or a clock-derived renewal.
 * Parsing retained metadata does not grant current supplier admission. */
export const fulfillmentSupplierWindowSchema = z.object({
  approvalReceivedAt: fulfillmentTimestampSchema,
  expiresAt: fulfillmentTimestampSchema,
  maximumDurationMs: z.literal(FULFILLMENT_SUPPLIER_WINDOW_MAX_MS),
}).strict().refine(value => {
  const duration = Date.parse(value.expiresAt) - Date.parse(value.approvalReceivedAt);
  return duration > 0 && duration <= value.maximumDurationMs;
}, "Supplier window must be positive and at most 90 minutes");

export type FulfillmentSupplierWindow = z.infer<typeof fulfillmentSupplierWindowSchema>;

export function matchesFulfillmentSupplierWindow(value: {
  supplierWindow: FulfillmentSupplierWindow; expiresAt: string; approvedAt?: string;
}): boolean {
  return value.expiresAt === value.supplierWindow.expiresAt &&
    (value.approvedAt === undefined || Date.parse(value.supplierWindow.approvalReceivedAt) <= Date.parse(value.approvedAt) &&
      Date.parse(value.approvedAt) < Date.parse(value.expiresAt));
}
