import {
  EntityComponentTypes,
  EntityInventoryComponent,
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
  ACTIONBAR_PROGRESS_TICKS,
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
import { tr, withProgressBar } from "../utils/message";
import { StorageMap } from "./storageMap";
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

  /** 把 sourceDim 的 sourceLoc 处箱子复制到暂存维度的 destLoc 槽位 */
  private static async captureToStorage(
    sourceDim: Dimension,
    sourceLoc: Vector3,
    destLoc: Vector3,
  ): Promise<boolean> {
    const storage = this.getStorageDimension();

    const done = await withTempTickingArea(storage, destLoc, () => {
      // 暂存槽位必须为空
      let destBlock: Block | undefined;
      try {
        destBlock = storage.getBlock(destLoc);
      } catch {
        destBlock = undefined;
      }
      if (!destBlock || !destBlock.isAir) return false;

      const structureId = `${STRUCTURE_PREFIX}${structureSeq++}`;
      try {
        world.structureManager.createFromWorld(
          structureId,
          sourceDim,
          sourceLoc,
          sourceLoc,
          { includeEntities: false },
        );
        world.structureManager.place(structureId, storage, destLoc);
        world.structureManager.delete(structureId);
      } catch (error) {
        console.warn(`[MoveChest] capture failed: ${error}`);
        return false;
      }

      // 校验复制成功
      const placed = storage.getBlock(destLoc);
      return !!placed && CHEST_TYPE_IDS.has(placed.typeId);
    });

    return done === true;
  }

  private static async pickupChest(
    player: Player,
    block: Block,
  ): Promise<void> {
    const held = mainhand(player);
    if (!held) return;
    const tier = getTierByItemId(held.typeId);
    if (!tier) return;

    const chestLoc = { ...block.location };

    // 分配暂存槽位
    const storageSlot = StorageMap.allocSlot();
    if (storageSlot === undefined) {
      player.sendMessage(tr("movechest.msg.pickup_full"));
      return;
    }
    const storedLoc = StorageMap.locFromSlot(storageSlot)!;

    const ok =
      (await withProgressBar(
        player,
        "movechest.progress.pickup",
        ACTIONBAR_PROGRESS_TICKS,
        () => this.captureToStorage(block.dimension, chestLoc, storedLoc),
      )) === true;
    if (!ok) {
      StorageMap.freeSlot(storageSlot); // 归还失败的槽位
      player.sendMessage(tr("movechest.msg.pickup_capture_fail"));
      return;
    }

    // 记录占用映射（来源信息）
    StorageMap.setEntry(storageSlot, { d: block.dimension.id, l: chestLoc });

    if (REMOVE_SOURCE_ON_PICKUP) {
      try {
        block.dimension.runCommand(
          `setblock ${block.location.x} ${block.location.y} ${block.location.z} air`,
        );
      } catch {
        /* ignore */
      }
    }

    if (!this.isMainhand(player, tier.itemId)) {
      player.sendMessage(tr("movechest.msg.pickup_lost_tool"));
      return;
    }

    // 耐久仅在搬运完成（放置）时消耗；搬起只透传当前耐久
    const curData = decodeToolData(held.getLore());
    const du = Math.min(
      curData?.du ?? tier.maxDurability,
      tier.maxDurability,
    );

    this.getMainhandSlot(player)?.setItem(
      this.buildUsedItem(
        tier.id,
        block.dimension.id,
        chestLoc,
        du,
        storageSlot,
      ),
    );
    player.sendMessage(
      tr("movechest.msg.pickup_ok", `#${storageSlot}`, du, tier.maxDurability),
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
    if (
      !data ||
      typeof data.s !== "number" ||
      !data.l ||
      typeof data.du !== "number"
    ) {
      player.sendMessage(tr("movechest.msg.bad_data_slot"));
      return;
    }
    // 品级优先取 lore，兜底按使用中物品 id 反查
    const tier = getTier(data.t) ?? getTierByUsedId(held.typeId);
    if (!tier) {
      player.sendMessage(tr("movechest.msg.bad_data_tier"));
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
      player.sendMessage(tr("movechest.msg.place_blocked"));
      return;
    }

    const storage = this.getStorageDimension();
    const storedLoc = StorageMap.locFromSlot(data.s);
    if (!storedLoc) {
      player.sendMessage(tr("movechest.msg.slot_out_of_range"));
      return;
    }

    const restoredType = await withProgressBar(
      player,
      "movechest.progress.place",
      ACTIONBAR_PROGRESS_TICKS,
      () =>
        withTempTickingArea(storage, storedLoc, () => {
          const stored = storage.getBlock(storedLoc);
          if (!stored || !CHEST_TYPE_IDS.has(stored.typeId)) {
            return undefined;
          }

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
            return undefined;
          }

          // 清理该暂存槽位方块
          try {
            storage.getBlock(storedLoc)?.setType("minecraft:air");
          } catch {
            /* ignore */
          }

          return stored.typeId;
        }),
    );

    if (!restoredType) {
      player.sendMessage(tr("movechest.msg.slot_empty"));
      return;
    }

    // 回收槽位
    StorageMap.freeSlot(data.s);

    if (!this.isMainhand(player, tier.usedItemId)) {
      player.sendMessage(tr("movechest.msg.place_manual_check"));
      return;
    }

    // 搬运完成：扣耐久后重回对应品级的静置搬箱器
    const nextDu = data.du - DURABILITY_COST;
    const slot = this.getMainhandSlot(player);
    if (nextDu <= 0) {
      slot?.setItem(undefined);
      player.sendMessage(
        tr("movechest.msg.place_broken", target.x, target.y, target.z),
      );
      return;
    }

    slot?.setItem(this.buildIdleItem(tier.id, nextDu));
    player.sendMessage(
      tr(
        "movechest.msg.place_ok",
        target.x,
        target.y,
        target.z,
        nextDu,
        tier.maxDurability,
      ),
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
    storageSlot: number,
  ): ItemStack {
    const tier = getTier(tierId);
    const item = new ItemStack(
      tier?.usedItemId ?? tier?.itemId ?? MOVETOOL_FALLBACK_ID,
      1,
    );
    item.setLore(
      buildUsedLore({
        t: tierId,
        du,
        s: storageSlot,
        d: sourceDimId,
        l: loc,
      }),
    );
    return item;
  }

  private static buildIdleItem(tierId: string, du: number): ItemStack {
    const tier = getTier(tierId);
    const item = new ItemStack(tier?.itemId ?? MOVETOOL_FALLBACK_ID, 1);
    item.setLore(buildIdleLore(tierId, du));
    return item;
  }

  // ---------- 定时任务 ----------

  /** 背包/副手持有使用中搬箱器 -> 缓慢 III（每 20t 刷新一次） */
  public static startCarrySlowTask(): void {
    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        if (!this.isCarryingUsedTool(player)) continue;
        player.addEffect("slowness", 45, {
          amplifier: 2,
          showParticles: false,
        });
      }
    }, 20);
  }

  private static isCarryingUsedTool(player: Player): boolean {
    const container = (
      player.getComponent(EntityComponentTypes.Inventory) as
        | EntityInventoryComponent
        | undefined
    )?.container;
    if (container) {
      for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i);
        if (item && USED_TOOL_IDS.has(item.typeId)) return true;
      }
    }
    const offhand = player
      .getComponent(EntityComponentTypes.Equippable)
      ?.getEquipmentSlot(EquipmentSlot.Offhand)
      .getItem();
    return !!offhand && USED_TOOL_IDS.has(offhand.typeId);
  }
}
