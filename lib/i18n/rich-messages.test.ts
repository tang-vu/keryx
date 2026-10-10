import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createRichMessages } from "./rich-messages";

const render = (children: ReturnType<ReturnType<typeof createRichMessages>>) => renderToStaticMarkup(createElement("h1", null, children));

describe("named catalogue React nodes", () => {
  it("preserves semantic emphasis and link nodes without extra DOM", () => {
    const message = createRichMessages("en");
    expect(render(message("account.signInTitle", { brand: createElement("em", { className: "italic text-paid" }, "Keryx.") })))
      .toBe('<h1>Sign in to <em class="italic text-paid">Keryx.</em></h1>');
    const link = createElement("a", { href: "/register" }, "restart");
    expect(render(message("account.registrationWalletMismatch", { restartLink: link })))
      .toContain('or <a href="/register">restart</a>.</h1>');
  });

  it("allows a selected sentence to reorder and repeat its named node", () => {
    const message = createRichMessages("vi", { "account.signInTitle": "{brand} / sign in / {brand}" });
    expect(render(message("account.signInTitle", { brand: createElement("em", null, "Keryx.") })))
      .toBe('<h1><em>Keryx.</em> / sign in / <em>Keryx.</em></h1>');
  });

  it("renders untrusted parameter strings as escaped text, without recursive interpolation", () => {
    expect(render(createRichMessages("en")("account.signInTitle", { brand: "<script>{brand}</script>" })))
      .toBe("<h1>Sign in to &lt;script&gt;{brand}&lt;/script&gt;</h1>");
    expect(render(createRichMessages("en")("account.step", { number: 0 }))).toBe("<h1>Step 0</h1>");
  });

  it("retains the existing validated locale snapshot and English fallback reporting", () => {
    const report = vi.fn();
    const catalogue = { "account.signInTitle": "{brand}: sign in" };
    const message = createRichMessages("vi", catalogue, report);
    catalogue["account.signInTitle"] = "changed";
    expect(render(message("account.signInTitle", { brand: "Keryx." }))).toBe("<h1>Keryx.: sign in</h1>");
    expect(render(message("account.step", { number: 2 }))).toBe("<h1>Step 2</h1>");
    expect(report).toHaveBeenCalledExactlyOnceWith("vi", "account.step");
  });

  it("refuses missing, inherited, accessor and extra node parameters or mismatched templates", () => {
    const message = createRichMessages("en");
    // @ts-expect-error Named node is required.
    expect(() => message("account.signInTitle")).toThrow("Missing rich message parameter");
    expect(() => message("account.signInTitle", { brand: undefined })).toThrow("Missing rich message parameter");
    expect(() => message("account.signInTitle", Object.create({ brand: "inherited" }))).toThrow("Missing rich message parameter");
    const accessor = Object.defineProperty({}, "brand", { get() { throw Error("must not execute"); }, enumerable: true });
    expect(() => message("account.signInTitle", accessor as { brand: string })).toThrow("Missing rich message parameter");
    // @ts-expect-error Extra named parameters are refused both statically and at runtime.
    expect(() => message("account.signInTitle", { brand: "Keryx.", other: "extra" })).toThrow("Unexpected rich message parameter");
    expect(() => createRichMessages("vi", { "account.signInTitle": "{other}" })).toThrow("Invalid message catalogue");
    // @ts-expect-error Unknown catalogue keys are refused.
    expect(() => message("account.unknown")).toThrow("Unknown English source message");
  });
});
