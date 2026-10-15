/** Exact finite #257 data qualification; no caller-supplied exception table. */
export type StockQualification = object;
export type CompiledPin = { path: string; sha256: string };
export type CompiledCopyProof = {
  compiledPins: CompiledPin[];
  shapeSha256: string;
  stockQualificationSha256: string;
};
export function qualifyStock(dist: string, physicalCopy?: boolean): StockQualification;
export function assertStockUnchanged(dist: string, qualification: StockQualification): void;
export function qualificationHash(qualification: StockQualification): string;
export function stockPins(qualification: StockQualification): CompiledPin[];
export function stockShapeHash(qualification: StockQualification): string;
export function copyStock(dist: string, destination: string, qualification: StockQualification): CompiledCopyProof;
