import { sharedHelperMessages } from "./shared-helpers";
export const reportPresentationEnglish = Object.freeze({
  target: sharedHelperMessages["reportExport.target"],
  coverage: sharedHelperMessages["reportExport.coverage"],
  noSources: sharedHelperMessages["reportExport.noAdmittedSources"],
  documentVersion: sharedHelperMessages["reportExport.documentVersion"],
  provenance: sharedHelperMessages["reportExport.provenance"],
  scope: sharedHelperMessages["reportExport.originalScope"],
  scholarly: sharedHelperMessages["reportExport.scholarly"],
} as const);
export type ReportPresentationCatalogue = { readonly [K in keyof typeof reportPresentationEnglish]: string };
