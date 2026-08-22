import type { Vector3 } from "@minecraft/server";

/** lore 中 JSON 数据行 */
export interface ToolLoreData {
  /** 工具品级 id（wood/stone/iron/diamond） */
  t: string;
  /** 当前耐久 */
  du: number;
  /** 暂存槽位索引（仅使用中状态存在） */
  s?: number;
  /** 原始维度 id（仅使用中状态存在） */
  d?: string;
  /** 来源坐标（仅使用中状态存在，原世界位置） */
  l?: Vector3;
}
