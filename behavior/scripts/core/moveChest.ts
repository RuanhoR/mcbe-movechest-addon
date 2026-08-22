import {
  EntityComponentTypes,
  EquipmentSlot,
  ItemStack,
  system,
  world,
  type Block,
  type ContainerSlot,
  type Dimension,
  type Player,
  type PlayerInteractWithBlockBeforeEvent,
  type Vector3,
} from "@minecraft/server";
import {
  CHEST_TYPE_IDS,
  DURABILITY_COST,
  getTier,
  getTierByItemId,
  getTierByUsedId,
  IDLE_TOOL_IDS,
  REMOVE_SOURCE_ON_PICKUP,
  STORAGE_DIMENSION_ID,
  STRUCTURE_PREFIX,
  USED_TOOL_IDS,
} from "../config";
import {
  addVec,
  buildIdleLore,
  buildUsedLore,
  decodeToolData,
  FACE_VECTORS,
  mainhand,
  withTempTickingArea,
} from "../utils/utils";
import type { ToolLoreData } from "../types";

let structureSeq = 0;

const MOVETOOL_FALLBACK_ID = "movechest:wood_movetool";

export class MoveChestCore {
  /** 正在处理的方块锁，防止重复触发 */
  private static readonly busy = new Set<string>();

  /** 注册暂存维度，必须在 system.beforeEvents.startup（early execution）中调用 */
  public static registerStorageDimension(): void {
    system.beforeEvents.startup.subscribe((init) => {
      try {
        init.dimensionRegistry.registerCustomDimension(STORAGE_DIMENSION_ID);
      } catch (error) {
        console.warn(`[MoveChest] register dimension failed: ${error}`);
      }
    });
  }

  public static getStorageDimension(): Dimension {
    return world.getDimension(STORAGE_DIMENSION_ID);
  }

  // ---------- 触摸方块入口 ----------

  public static onTouchBlock(event: PlayerInteractWithBlockBeforeEvent): void {
    const item = event.itemStack;
    if (!item || !event.isFirstEvent) return;
    const block = event.block;
    const lockKey = `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;
    if (this.busy.has(lockKey)) return;

    // 静置搬箱器：搬起箱子
    if (IDLE_TOOL_IDS.has(item.typeId)) {
      if (!CHEST_TYPE_IDS.has(block.typeId)) return;
      event.cancel = true;
      this.busy.add(lockKey);
      system.run(() => {
        MoveChestCore.pickupChest(event.player, block).finally(() =>
          MoveChestCore.busy.delete(lockKey),
        );
      });
      return;
    }

    // 使用中搬箱器：放下箱子
    if (USED_TOOL_IDS.has(item.typeId)) {
      event.cancel = true;
      this.busy.add(lockKey);
      const face = event.blockFace;
      system.run(() => {
        MoveChestCore.placeChest(event.player, block, face).finally(() =>
          MoveChestCore.busy.delete(lockKey),
        );
      });
    }
  }

  // ---------- 搬起：箱子 -> 暂存维度 ----------

  /** 把 sourceDim 的 chestLoc 处箱子复制到暂存维度的对应位置 */
  private static async captureToStorage(
    sourceDim: Dimension,
    chestLoc: Vector3,
  ): Promise<boolean> {
    const storage = this.getStorageDimension();

    const done = await withTempTickingArea(storage, chestLoc, () => {
      // 暂存位置必须为空
      let destBlock: Block | undefined;
      try {
        destBlock = storage.getBlock(chestLoc);
      } catch {
        destBlock = undefined;
      }
      if (!destBlock || !destBlock.isAir) return false;

      const structureId = `${STRUCTURE_PREFIX}${structureSeq++}`;
      try {
        world.structureManager.createFromWorld(
          structureId,
          sourceDim,
          chestLoc,
          chestLoc,
          { includeEntities: false },
        );
        world.structureManager.place(structureId, storage, chestLoc);
        world.structureManager.delete(structureId);
      } catch (error) {
        console.warn(`[MoveChest] capture failed: ${error}`);
        return false;
      }

      // 校验复制成功
      const placed = storage.getBlock(chestLoc);
      return !!placed && CHEST_TYPE_IDS.has(placed.typeId);
    });

    return done === true;
  }

  private static async pickupChest(player: Player, block: Block): Promise<void> {
    const held = mainhand(player);
    if (!held) return;
    const tier = getTierByItemId(held.typeId);
    if (!tier) return;

    const chestLoc = { ...block.location };

    const ok = await this.captureToStorage(block.dimension, chestLoc);
    if (!ok) {
      player.sendMessage("§c[搬箱器]§r 暂存失败：目标暂存位被占用或区块加载异常");
      return;
    }

    if (REMOVE_SOURCE_ON_PICKUP) {
      try {
        block.dimension.getBlock(chestLoc)?.setType("minecraft:air");
      } catch {
        /* ignore */
      }
    }

    if (!this.isMainhand(player, tier.itemId)) {
      player.sendMessage("§c[搬箱器]§r 物品已不在主手，箱子仍暂存于对应坐标");
      return;
    }

    // 扣耐久：当前耐久取自 lore（无 lore 视为满耐久）
    const curData = decodeToolData(held.getLore());
    const curDu = Math.min(curData?.du ?? tier.maxDurability, tier.maxDurability);
    const nextDu = curDu - DURABILITY_COST;

    const slot = this.getMainhandSlot(player);
    if (nextDu <= 0) {
      slot?.setItem(undefined);
      player.sendMessage(
        `§c[搬箱器]§r 工具已损坏！箱子仍暂存于 §7(${chestLoc.x}, ${chestLoc.y}, ${chestLoc.z})§r，请尽快用新工具取回`,
      );
      return;
    }

    slot?.setItem(this.buildUsedItem(tier.id, block.dimension.id, chestLoc, nextDu));
    player.sendMessage(
      `§a[搬箱器]§r 已搬起箱子暂存于 §7(${chestLoc.x}, ${chestLoc.y}, ${chestLoc.z})§r §8[耐久 ${nextDu}/${tier.maxDurability}]`,
    );
  }

  // ---------- 放下：暂存维度 -> 世界 ----------

  private static async placeChest(
    player: Player,
    block: Block,
    face: keyof typeof FACE_VECTORS,
  ): Promise<void> {
    const held = mainhand(player);
    if (!held || !USED_TOOL_IDS.has(held.typeId)) return;

    const data: ToolLoreData | undefined = decodeToolData(held.getLore());
    if (!data || !data.l || typeof data.du !== "number") {
      player.sendMessage("§c[搬箱器]§r 数据损坏：未找到箱子暂存坐标");
      return;
    }
    // 品级优先取 lore，兜底按使用中物品 id 反查
    const tier = getTier(data.t) ?? getTierByUsedId(held.typeId);
    if (!tier) {
      player.sendMessage("§c[搬箱器]§r 数据损坏：未知工具品级");
      return;
    }

    const dir = FACE_VECTORS[face];
    if (!dir) return;
    const target = addVec(block.location, dir);

    // 目标位置必须为空
    let targetBlock: Block | undefined;
    try {
      targetBlock = block.dimension.getBlock(target);
    } catch {
      targetBlock = undefined;
    }
    if (!targetBlock || !(targetBlock.isAir || targetBlock.isLiquid)) {
      player.sendMessage("§c[搬箱器]§r 目标位置被占用，无法放置箱子");
      return;
    }

    const storage = this.getStorageDimension();
    const storedLoc = data.l;

    let restoredType: string | undefined;
    await withTempTickingArea(storage, storedLoc, () => {
      const stored = storage.getBlock(storedLoc);
      if (!stored || !CHEST_TYPE_IDS.has(stored.typeId)) return;
      restoredType = stored.typeId;

      const structureId = `${STRUCTURE_PREFIX}${structureSeq++}`;
      try {
        world.structureManager.createFromWorld(
          structureId,
          storage,
          storedLoc,
          storedLoc,
          { includeEntities: false },
        );
        world.structureManager.place(structureId, block.dimension, target);
        world.structureManager.delete(structureId);
      } catch (error) {
        console.warn(`[MoveChest] restore failed: ${error}`);
        restoredType = undefined;
        return;
      }

      // 清理暂存维度：移除暂存方块与实体
      try {
        storage.getBlock(storedLoc)?.setType("minecraft:air");
      } catch {
        /* ignore */
      }
      for (const entity of storage.getEntities()) {
        try {
          entity.remove();
        } catch {
          /* ignore */
        }
      }
    });

    if (!restoredType) {
      player.sendMessage("§c[搬箱器]§r 暂存数据失效：暂存处没有箱子");
      return;
    }

    if (!this.isMainhand(player, tier.usedItemId)) {
      player.sendMessage("§a[搬箱器]§r 箱子已放置，请手动检查工具状态");
      return;
    }

    // 扣耐久后重回对应品级的静置搬箱器
    const nextDu = data.du - DURABILITY_COST;
    const slot = this.getMainhandSlot(player);
    if (nextDu <= 0) {
      slot?.setItem(undefined);
      player.sendMessage(`§c[搬箱器]§r 工具已损坏！箱子已放置于 §7(${target.x}, ${target.y}, ${target.z})`);
      return;
    }

    slot?.setItem(this.buildIdleItem(tier.id, nextDu));
    player.sendMessage(
      `§a[搬箱器]§r 箱子已放置于 §7(${target.x}, ${target.y}, ${target.z})§r §8[耐久 ${nextDu}/${tier.maxDurability}]`,
    );
  }

  // ---------- 工具函数 ----------

  private static getMainhandSlot(player: Player): ContainerSlot | undefined {
    return player
      .getComponent(EntityComponentTypes.Equippable)
      ?.getEquipmentSlot(EquipmentSlot.Mainhand);
  }

  /** 校验主手物品是否仍为 expectId（异步操作后防止物品被切换） */
  private static isMainhand(player: Player, expectId: string): boolean {
    const current = mainhand(player);
    return !!current && current.typeId === expectId;
  }

  private static buildUsedItem(
    tierId: string,
    sourceDimId: string,
    loc: Vector3,
    du: number,
  ): ItemStack {
    const tier = getTier(tierId);
    const item = new ItemStack(tier?.usedItemId ?? tier?.itemId ?? MOVETOOL_FALLBACK_ID, 1);
    item.setLore(buildUsedLore({ t: tierId, du, d: sourceDimId, l: loc }));
    return item;
  }

  private static buildIdleItem(tierId: string, du: number): ItemStack {
    const tier = getTier(tierId);
    const item = new ItemStack(tier?.itemId ?? MOVETOOL_FALLBACK_ID, 1);
    item.setLore(buildIdleLore(tierId, du));
    return item;
  }
}
