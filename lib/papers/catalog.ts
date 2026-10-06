import data from "./catalog-data.json";
import { paperRecordSchema } from "./types";

/** Observed original bibliographic records, never retained paper text or answer evidence. */
export const PAPER_CATALOG = paperRecordSchema.array().max(100).parse(data);
