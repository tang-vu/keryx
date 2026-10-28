import assert from "node:assert/strict";
import { build } from "esbuild";

/** Real evidence/PDF components and lazy locale chunks in a browser with all HTTP denied. */
export async function buildEvidenceLanguageBrowserFixture(root: string) {
  const result = await build({ absWorkingDir: root, stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{AnswerEvidenceStatus}from'./components/keryx/answer-evidence-status';
import{PdfReadingScope}from'./components/keryx/pdf-reading-scope';
import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';
import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
import{createMessages}from'./lib/i18n/messages';
import{createRichMessages}from'./lib/i18n/rich-messages';
window.syntheticRequests=[];
window.fetch=async(input,init={})=>{
window.syntheticRequests.push({url:String(input),method:init.method||'GET'});
throw new Error('Evidence language fixture must remain local');
};
const root=createRoot(document.getElementById('root'));
window.renderEvidenceLanguage=async({locale,run,pdfTextScope})=>{
const preview=await loadUiPreview(locale);
const value={...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages),richMessage:createRichMessages(locale,preview.$messages)};
root.render(<UiCopyContext.Provider value={value}>
<section data-view="language-evidence"><AnswerEvidenceStatus run={run}/></section>
<section data-view="language-pdf"><PdfReadingScope provenance={{extraction:'pdf',pdfTextScope}}/></section>
</UiCopyContext.Provider>);
};`, loader: "tsx", resolveDir: root }, bundle: true, write: false, metafile: true,
    platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll("\\", "/"));
  for (const module of ["components/keryx/answer-evidence-status.tsx", "components/keryx/pdf-reading-scope.tsx", "lib/i18n/ui-preview-catalogues.ts"])
    assert(inputs.some(path => path.endsWith(module)), `Actual evidence-language module missing: ${module}`);
  assert(!inputs.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws|@circle-fin)(?:\/|$)/u.test(path)),
    "Wallet SDKs and Node JWT code must not enter the evidence-language fixture");
  return result;
}
