# MoveChest

A Minecraft Bedrock addon (behavior + resource packs). Pick up chests together
with their contents using the Move Tool, then place them back anywhere.
Built with [mbler](https://github.com/RuanhoR/mbler) and the MCX DSL.

中文说明见 [README_zh.md](./README_zh.md)。

## Gameplay

| Action | Behavior |
| --- | --- |
| Idle Move Tool + right-click a chest | Pick up: chest is copied into a slot of the storage dimension, original chest disappears, tool switches to its "in use" variant with lore data |
| In-use Move Tool + right-click any block | Place down: destination is one block along the clicked face, chest is copied back from the storage dimension |
| Carrying an in-use Move Tool | Slowness III (refreshed by a scheduled task) |

- **Tiers & durability**: Wood 10 / Stone 50 / Iron 200 / Diamond 700. Each successful pick up or place down costs 1 durability. Durability lives in the item's lore; the tool breaks at zero.
- **Restore on place down**: the in-use item records its tier, and reverts to the matching idle tool after placing.
- **Storage dimension**: `movechest:mover_dim` (void generator), registered via `system.beforeEvents.startup`. Slots are allocated one cell at a time starting at `(0,0,0)` (x < 30000, then z < 30000, then y < 100) and recycled after use; the occupancy mapping is stored chunked in world dynamic properties.

## Recipes

All tiers share the same crafting pattern:

```
K K
KKK
X
```

`K` = stick; `X` on the last row is the tier material:

| Tier | X material | Item ID | Durability |
| --- | --- | --- | --- |
| Wood | Stick | `movechest:wood_movetool` | 10 |
| Stone | Cobblestone | `movechest:stone_movetool` | 50 |
| Iron | Iron Ingot | `movechest:iron_movetool` | 200 |
| Diamond | Diamond | `movechest:diamond_movetool` | 700 |

Each tier has its own in-use variant `movechest:<tier>_movetool_used`.

## Project Layout

```
behavior/scripts/
├── index.ts          # entry: registers storage dimension at startup, mounts app
├── app.mcx           # App MCX, subscribes events
├── event.mcx         # Event MCX: @before playerInteractWithBlock
├── Items.mcx         # Component MCX: 8 item definitions with icons
├── Recipe.mcx        # Component MCX: 4 crafting recipes
├── config.ts         # tier table, dimension id, durability/ticking constants
├── types.ts          # lore data structures
├── utils/utils.ts    # mainhand helpers, face vectors, lore codec, temp ticking area
├── assets/           # item textures
└── core/
    ├── moveChest.ts    # pickup/place-down flow, slowness task
    └── storageMap.ts   # storage dimension slot allocation & recycling
resources/texts/      # zh_CN / en_US language files
```

## Development

```bash
pnpm install        # install dependencies
pnpm type-check     # mcx-tsc type check
pnpm build          # release build -> dist.mcaddon
pnpm dev-build      # development build
pnpm dev            # watch mode
```

## Implementation Notes

- **Temporary ticking area**: before touching the storage dimension, a temporary ticking area is created via `world.tickingAreaManager`; once loaded it waits an extra 8 ticks, runs the copy, and is removed in `finally`.
- **Structure copy**: `structureManager.createFromWorld` + `place`, preserving chest facing and container NBT.
- **Debounce**: only `isFirstEvent` interactions are handled, and per-block locks prevent concurrent processing of the same position.
