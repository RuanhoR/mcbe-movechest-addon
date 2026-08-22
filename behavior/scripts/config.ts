/** 暂存维度 typeId（虚空生成器，startup 时注册） */
export const STORAGE_DIMENSION_ID = "movechest:mover_dim";

/** 搬箱器 - 使用中（搬着箱子，各品级独立） */
export type ToolTierId = "wood" | "stone" | "iron" | "diamond";

export interface ToolTier {
  id: ToolTierId;
  /** 静置物品 id */
  itemId: string;
  /** 使用中物品 id */
  usedItemId: string;
  /** 最大耐久 */
  maxDurability: number;
  /** 配方第三行材料（第一二行固定为木棍） */
  recipeMaterial: string;
}

/**
 * 木制(10) / 石制(50) / 铁制(200) / 钻石(700)
 * 配方：
 *   K K
 *   KKK
 *   X     （木制的 X 也是木棍；石/铁/钻分别为圆石/铁锭/钻石）
 */
export const TOOL_TIERS: Record<ToolTierId, ToolTier> = {
  wood: {
    id: "wood",
    itemId: "movechest:wood_movetool",
    usedItemId: "movechest:wood_movetool_used",
    maxDurability: 10,
    recipeMaterial: "minecraft:stick",
  },
  stone: {
    id: "stone",
    itemId: "movechest:stone_movetool",
    usedItemId: "movechest:stone_movetool_used",
    maxDurability: 50,
    recipeMaterial: "minecraft:cobblestone",
  },
  iron: {
    id: "iron",
    itemId: "movechest:iron_movetool",
    usedItemId: "movechest:iron_movetool_used",
    maxDurability: 200,
    recipeMaterial: "minecraft:iron_ingot",
  },
  diamond: {
    id: "diamond",
    itemId: "movechest:diamond_movetool",
    usedItemId: "movechest:diamond_movetool_used",
    maxDurability: 700,
    recipeMaterial: "minecraft:diamond",
  },
};

/** 所有静置物品 id */
export const IDLE_TOOL_IDS: ReadonlySet<string> = new Set(
  Object.values(TOOL_TIERS).map((tier) => tier.itemId),
);

/** 所有使用中物品 id */
export const USED_TOOL_IDS: ReadonlySet<string> = new Set(
  Object.values(TOOL_TIERS).map((tier) => tier.usedItemId),
);

export function getTier(id: string): ToolTier | undefined {
  return TOOL_TIERS[id as ToolTierId];
}

export function getTierByItemId(itemId: string): ToolTier | undefined {
  return Object.values(TOOL_TIERS).find((tier) => tier.itemId === itemId);
}

export function getTierByUsedId(itemId: string): ToolTier | undefined {
  return Object.values(TOOL_TIERS).find((tier) => tier.usedItemId === itemId);
}

/** 每次成功搬起 / 放下消耗的耐久 */
export const DURABILITY_COST = 1;

/** 可以搬起的方块 */
export const CHEST_TYPE_IDS: ReadonlySet<string> = new Set([
  "minecraft:chest",
  "minecraft:trapped_chest",
]);

/** 创建常加载区块后的额外等待时间（tick），等待区块完全可用 */
export const LOAD_WAIT_TICKS = 2;

/** 临时结构 id 前缀（StructureSaveMode.Memory，用完即删） */
export const STRUCTURE_PREFIX = "movechest:tmp_";

/** 临时常加载区块 id 前缀 */
export const TICKING_AREA_PREFIX = "movechest:ta_";

/** 搬起成功后是否移除原位置的箱子（false 则为复制行为） */
export const REMOVE_SOURCE_ON_PICKUP = true;
