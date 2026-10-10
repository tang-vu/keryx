import { createElement, Fragment, type ReactNode } from "react";
import {
  createMessages, englishMessages, type MessageArguments, type MessageCatalogue,
  type MessageKey, type MissingMessageReporter,
} from "./messages";
import type { UiLocale } from "./locales";

/** Full catalogue sentences with named React nodes; no HTML or DOM wrappers. */
export function createRichMessages(locale: UiLocale, catalogue: MessageCatalogue = {}, reportMissing?: MissingMessageReporter) {
  const resolve = createMessages(locale, catalogue, reportMissing);
  return function richMessage<K extends MessageKey>(key: K, ...args: MessageArguments<K, ReactNode>): ReactNode[] {
    if (!Object.hasOwn(englishMessages, key)) throw new Error("Unknown English source message");
    const names = [...new Set([...englishMessages[key].matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]))];
    const parameters = Object.getOwnPropertyDescriptors(args[0] ?? {});
    if (Reflect.ownKeys(parameters).some(name => typeof name !== "string" || !names.includes(name))) {
      throw new Error("Unexpected rich message parameter");
    }
    for (const name of names) {
      if (!Object.hasOwn(parameters, name) || !("value" in parameters[name]) || parameters[name].value === undefined) {
        throw new Error(`Missing rich message parameter: ${name}`);
      }
    }
    // Reuse the validated locale snapshot/fallback, leaving placeholders intact.
    // Tokenize that template before inserting data, so values are never reparsed.
    const templateArgs = (names.length ? [Object.fromEntries(names.map(name => [name, `{${name}}`]))] : []) as MessageArguments<K>;
    const template = resolve(key, ...templateArgs);
    const parts: ReactNode[] = [];
    let offset = 0;
    for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)) {
      parts.push(template.slice(offset, match.index));
      parts.push(createElement(Fragment, { key: `${match[1]}:${match.index}` }, parameters[match[1]].value));
      offset = match.index + match[0].length;
    }
    parts.push(template.slice(offset));
    return parts;
  };
}
