import {
  Direction,
  EntityComponentTypes,
  EquipmentSlot,
  ItemStack,
  system,
  world,
  type Dimension,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { getTier, LOAD_WAIT_TICKS, TICKING_AREA_PREFIX } from "../config";
import type { ToolLoreData } from "../types";

/** 获取玩家主手物品 */
export function mainhand(player: Player): ItemStack | undefined {
  return player
    .getComponent(EntityComponentTypes.Equippable)
    ?.getEquipmentSlot(EquipmentSlot.Mainhand)
    .getItem();
}

/** blockFace 方位 -> 单格偏移向量 */
export const FACE_VECTORS: Record<Direction, Vector3> = {
  [Direction.Up]: { x: 0, y: 1, z: 0 },
  [Direction.Down]: { x: 0, y: -1, z: 0 },
  [Direction.North]: { x: 0, y: 0, z: -1 },
  [Direction.South]: { x: 0, y: 0, z: 1 },
  [Direction.West]: { x: -1, y: 0, z: 0 },
  [Direction.East]: { x: 1, y: 0, z: 0 },
};

export function addVec(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(() => resolve(), ticks);
  });
}

let tickingAreaSeq = 0;

/**
 * 在 dimension 的 loc 处临时创建常加载区块：
 * 创建（Promise 返回即区块已加载并 tick）-> 额外等待 8t -> 执行 fn -> 删除常加载区块
 */
export async function withTempTickingArea<T>(
  dimension: Dimension,
  loc: Vector3,
  fn: () => T,
): Promise<T | undefined> {
  const manager = world.tickingAreaManager;
  const identifier = `${TICKING_AREA_PREFIX}${tickingAreaSeq++}`;
  try {
    await manager.createTickingArea(identifier, {
      dimension,
      from: { x: loc.x - 1, y: loc.y - 1, z: loc.z - 1 },
      to: { x: loc.x + 1, y: loc.y + 1, z: loc.z + 1 },
    });
    await waitTicks(LOAD_WAIT_TICKS);
    return fn();
  } catch (error) {
    console.warn(`[MoveChest] ticking area error: ${error}`);
    return undefined;
  } finally {
    if (manager.hasTickingArea(identifier)) {
      try {
        manager.removeTickingArea(identifier);
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------- lore 编解码 ----------

function durabilityLine(tierId: string, du: number): string {
  const max = getTier(tierId)?.maxDurability ?? du;
  const ratio = max > 0 ? du / max : 0;
  const color = ratio <= 0.2 ? "§c" : ratio <= 0.5 ? "§e" : "§a";
  return `§r§7耐久: ${color}${du}§r§7/§f${max}`;
}

/** 静置状态 lore：耐久显示行 + 数据行 */
export function buildIdleLore(tierId: string, du: number): string[] {
  return [
    durabilityLine(tierId, du),
    JSON.stringify({ t: tierId, du } satisfies ToolLoreData),
  ];
}

/** 使用中状态 lore：暂存坐标 + 耐久显示行 + 数据行 */
export function buildUsedLore(
  data: ToolLoreData & { d: string; l: Vector3 },
): string[] {
  return [
    `§r§7暂存坐标: §b${data.l.x}, ${data.l.y}, ${data.l.z}`,
    durabilityLine(data.t, data.du),
    JSON.stringify(data satisfies ToolLoreData),
  ];
}

/** 从 lore 中解析 JSON 数据行 */
export function decodeToolData(lore: string[]): ToolLoreData | undefined {
  for (const line of lore) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as ToolLoreData;
      if (
        typeof parsed.t === "string" &&
        typeof parsed.du === "number" &&
        (parsed.l === undefined ||
          (typeof parsed.l.x === "number" &&
            typeof parsed.l.y === "number" &&
            typeof parsed.l.z === "number"))
      ) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}
