import { world, type Vector3 } from "@minecraft/server";
import {
  DP_ALLOC_NEXT_KEY,
  DP_FREE_PREFIX,
  DP_MAP_PREFIX,
  FREE_CHUNK_SIZE,
  MAP_BUCKET_SIZE,
  SLOTS_X,
  SLOTS_Y,
  SLOTS_Z,
} from "../config";

/** 单个暂存槽位的来源信息 */
export interface SlotEntry {
  /** 来源维度 id */
  d: string;
  /** 来源坐标（原世界位置） */
  l: Vector3;
}

const SLOTS_PER_Y = SLOTS_X * SLOTS_Z;

function readString(key: string): string | undefined {
  const value = world.getDynamicProperty(key);
  return typeof value === "string" ? value : undefined;
}

function readJSON<T>(key: string): T | undefined {
  const raw = readString(key);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function writeJSON(key: string, value: unknown): void {
  world.setDynamicProperty(key, JSON.stringify(value));
}

/**
 * 暂存维度槽位分配表（单维度共享）：
 * - 从 (0,0,0) 起一格递归分配：x 最快，其次 z，最后 y（x<30000 / z<30000 / y<100）
 * - 放下后槽位回收进空闲链，优先复用
 * - 全部状态分块存储在 world 动态属性，避免单条超限
 */
export class StorageMap {
  static capacity(): number {
    return SLOTS_PER_Y * SLOTS_Y;
  }

  /** 槽位索引 -> 暂存维度坐标；越界返回 undefined */
  static locFromSlot(slot: number): Vector3 | undefined {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity()) {
      return undefined;
    }
    const y = Math.floor(slot / SLOTS_PER_Y);
    const rem = slot % SLOTS_PER_Y;
    return { x: rem % SLOTS_X, z: Math.floor(rem / SLOTS_X), y };
  }

  /** 分配一个槽位：优先回收空闲链，否则游标递增 */
  static allocSlot(): number | undefined {
    const recycled = this.popFree();
    if (recycled !== undefined) return recycled;
    const current = world.getDynamicProperty(DP_ALLOC_NEXT_KEY);
    const next = typeof current === "number" ? current : 0;
    if (next >= this.capacity()) return undefined;
    world.setDynamicProperty(DP_ALLOC_NEXT_KEY, next + 1);
    return next;
  }

  /** 回收槽位并清除其映射 */
  static freeSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0) return;
    this.pushFree(slot);
    this.removeEntry(slot);
  }

  // ---------- 空闲链 ----------

  private static popFree(): number | undefined {
    for (let i = 0; ; i++) {
      const key = `${DP_FREE_PREFIX}${i}`;
      if (readString(key) === undefined) return undefined;
      const arr = readJSON<number[]>(key) ?? [];
      if (arr.length === 0) continue;
      const slot = arr.shift()!;
      if (arr.length === 0) {
        world.setDynamicProperty(key, undefined); // 删空分块
      } else {
        writeJSON(key, arr);
      }
      return slot;
    }
  }

  private static pushFree(slot: number): void {
    for (let i = 0; ; i++) {
      const key = `${DP_FREE_PREFIX}${i}`;
      const raw = readString(key);
      if (raw === undefined) {
        writeJSON(key, [slot]); // 新建分块
        return;
      }
      const arr = readJSON<number[]>(key) ?? [];
      if (arr.length < FREE_CHUNK_SIZE) {
        arr.push(slot);
        writeJSON(key, arr);
        return;
      }
    }
  }

  // ---------- 占用映射 ----------

  private static bucketKey(slot: number): string {
    return `${DP_MAP_PREFIX}${Math.floor(slot / MAP_BUCKET_SIZE)}`;
  }

  static setEntry(slot: number, entry: SlotEntry): void {
    const key = this.bucketKey(slot);
    const map = readJSON<Record<string, SlotEntry>>(key) ?? {};
    map[slot % MAP_BUCKET_SIZE] = entry;
    writeJSON(key, map);
  }

  static getEntry(slot: number): SlotEntry | undefined {
    const map = readJSON<Record<string, SlotEntry>>(this.bucketKey(slot));
    return map ? map[slot % MAP_BUCKET_SIZE] : undefined;
  }

  static removeEntry(slot: number): void {
    const key = this.bucketKey(slot);
    const local = String(slot % MAP_BUCKET_SIZE);
    const map = readJSON<Record<string, SlotEntry>>(key);
    if (!map || !(local in map)) return;
    delete map[local];
    if (Object.keys(map).length === 0) {
      world.setDynamicProperty(key, undefined); // 删空分块
    } else {
      writeJSON(key, map);
    }
  }
}
