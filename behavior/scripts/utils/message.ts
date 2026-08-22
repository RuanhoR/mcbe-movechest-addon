import { system, type Player, type RawMessage } from "@minecraft/server";
import { waitTicks } from "./utils";

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

const PROGRESS_BAR_SLOTS = 20;

function renderBar(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * PROGRESS_BAR_SLOTS);
  return `§a${"■".repeat(filled)}§8${"□".repeat(PROGRESS_BAR_SLOTS - filled)}`;
}

/**
 * 执行 fn 期间在 actionbar 显示进度条：
 * 进度按 estimateTicks 匀速推进（封顶 95%），完成时置 100% 短暂停留后清除
 */
export async function withProgressBar<T>(
  player: Player,
  titleKey: string,
  estimateTicks: number,
  fn: () => Promise<T> | T,
): Promise<T | undefined> {
  const startedTick = system.currentTick;
  const render = (ratio: number) => {
    try {
      player.onScreenDisplay.setActionBar(
        rawMessage`${t(titleKey)} ${renderBar(ratio)}`,
      );
    } catch {
      /* ignore */
    }
  };
  render(0);
  const timer = system.runInterval(() => {
    const elapsed = system.currentTick - startedTick;
    render(Math.min(0.95, elapsed / estimateTicks));
  }, 1);
  try {
    const result = await fn();
    render(1);
    await waitTicks(8);
    return result;
  } catch (error) {
    console.warn(`[MoveChest] progress task error: ${error}`);
    return undefined;
  } finally {
    system.clearRun(timer);
    try {
      player.onScreenDisplay.setActionBar("");
    } catch {
      /* ignore */
    }
  }
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
