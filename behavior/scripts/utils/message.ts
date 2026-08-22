import type { RawMessage } from "@minecraft/server";

/** 翻译键（无参数） */
export function t(key: string): RawMessage {
  return { translate: key };
}

/** 翻译键（带 %1/%2... 参数） */
export function tr(
  key: string,
  ...args: (string | number)[]
): RawMessage {
  return { translate: key, with: args.map(String) };
}

export function rawMessage(...args: unknown[]): { rawtext: RawMessage[] } {
  const convert = (arg: unknown): RawMessage => {
    if (typeof arg === "string") return { text: arg };
    if (typeof arg === "number" || typeof arg === "boolean")
      return { text: String(arg) };
    if (arg === null || arg === undefined) return { text: "" };
    if (
      (typeof arg === "object" && (arg as RawMessage).text !== undefined) ||
      (arg as RawMessage).translate !== undefined ||
      (arg as RawMessage).rawtext !== undefined
    ) {
      return { ...arg } as RawMessage;
    }
    if (Array.isArray(arg)) {
      return { rawtext: arg.map((item) => convert(item)) };
    }
    try {
      return { text: JSON.stringify(arg) };
    } catch {
      return { text: "[Object]" };
    }
  };
  const firstArg = args[0];
  if (Array.isArray(firstArg) && "raw" in firstArg) {
    const strings = firstArg as TemplateStringsArray;
    const substitutions = args.slice(1);
    const result: RawMessage[] = [];

    for (let i = 0; i < strings.length; i++) {
      result.push({ text: strings[i] });
      if (i < substitutions.length) {
        result.push(convert(substitutions[i]));
      }
    }
    return { rawtext: result };
  }
  return {
    rawtext: args.map(convert),
  };
}
