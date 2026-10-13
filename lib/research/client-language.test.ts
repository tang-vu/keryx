import { expect, it } from "vitest";
import { clientPresentationLanguage, clientPresentationMessages } from "../../shared/i18n/client-language";

it("uses the finite system catalogue with an explicit override without enabling UI locales", () => {
  expect(clientPresentationLanguage("vi-VN")).toBe("vi");
  expect(clientPresentationLanguage("pt_BR")).toBe("pt");
  expect(clientPresentationLanguage("es-ES", "vi")).toBe("vi");
  expect(clientPresentationLanguage("vi-VN", "auto")).toBe("vi");
  expect(clientPresentationLanguage("zh-Hans")).toBe("en");
  expect(() => clientPresentationLanguage("vi-VN", "fr")).toThrow("Unsupported presentation language");
  for (const language of ["en", "vi", "pt", "es"] as const) {
    expect(clientPresentationMessages(language).controls.answer).toBeTruthy();
    expect(clientPresentationMessages(language).research("reportSources")).toBeTruthy();
  }
});
