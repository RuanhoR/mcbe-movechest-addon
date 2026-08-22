import { createApp } from "@mbler/mcx";
import { world } from "@minecraft/server";
import app from "./app.mcx";
import "./Items.mcx";
import "./Recipe.mcx";
import { MoveChestCore } from "./core/moveChest";

MoveChestCore.registerStorageDimension();
MoveChestCore.startCarrySlowTask();
createApp(app).mount(world);
console.log("[MoveChest] loaded, storage dim: movechest:mover_dim");
