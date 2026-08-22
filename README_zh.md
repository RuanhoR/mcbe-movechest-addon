# MoveChest 搬箱器

Minecraft Bedrock 附加包（行为包 + 资源包）。手持搬箱器把箱子连同内容物一起搬走，
再触摸任意方块按所点面放置回去。基于 [mbler](https://github.com/RuanhoR/mbler) + MCX DSL 开发。

English README see [README.md](./README.md)。

## 玩法

| 操作 | 行为 |
| --- | --- |
| 静置搬箱器 + 右键箱子 | 搬起：箱子被复制到暂存维度槽位，原箱消失，物品进入「使用中」状态并写入 lore |
| 使用中搬箱器 + 右键方块 | 放下：按 `blockFace` 方向推一格作为落点，箱子从暂存维度复制回来 |
| 背包内有使用中的搬箱器 | 获得 缓慢 III（定时任务刷新） |

- **品级与耐久**：木制 10 / 石制 50 / 铁制 200 / 钻石 700。每次成功搬起或放下消耗 1 点耐久，lore 中记录当前耐久，耗尽后工具损坏消失。
- **放下还原**：使用中物品记录品级，放完箱子后重回对应品级的静置搬箱器。
- **暂存维度**：`movechest:mover_dim`（虚空生成器），`system.beforeEvents.startup` 注册。槽位从 `(0,0,0)` 起一格递归分配（x<30000 → z<30000 → y<100），放下后槽位回收复用；占用映射分块存储在 world 动态属性中。

## 配方

工作台图案统一为：

```
K K
KKK
X
```

`K` = 木棍；第三行 `X` 为品级材料：

| 品级 | X 材料 | 物品 ID | 耐久 |
| --- | --- | --- | --- |
| 木制 | 木棍 | `movechest:wood_movetool` | 10 |
| 石制 | 圆石 | `movechest:stone_movetool` | 50 |
| 铁制 | 铁锭 | `movechest:iron_movetool` | 200 |
| 钻石 | 钻石 | `movechest:diamond_movetool` | 700 |

使用中状态为各品级独立物品 `movechest:<tier>_movetool_used`。

## 项目结构

```
behavior/scripts/
├── index.ts          # 入口：startup 注册暂存维度、挂载 App
├── app.mcx           # App MCX，订阅事件
├── event.mcx         # Event MCX：@before playerInteractWithBlock
├── Items.mcx         # Component MCX：8 个物品定义（含贴图绑定）
├── Recipe.mcx        # Component MCX：4 个合成配方
├── config.ts         # 品级表、维度 id、耐久/常加载等常量
├── types.ts          # lore 数据结构
├── utils/utils.ts    # 主手/方位向量/lore 编解码/临时常加载封装
├── assets/           # 物品贴图
└── core/
    ├── moveChest.ts    # 搬起/放下核心流程、缓慢 III 定时任务
    └── storageMap.ts   # 暂存维度槽位分配与回收（world dyprop 分块映射）
resources/texts/      # zh_CN / en_US 语言文件
```

## 开发

```bash
pnpm install        # 安装依赖
pnpm type-check     # mcx-tsc 类型检查
pnpm build          # 发布构建 -> dist.mcaddon
pnpm dev-build      # 开发构建
pnpm dev            # watch 模式
```

## 实现要点

- **临时常加载**：操作暂存维度前用 `world.tickingAreaManager` 创建临时区块，Promise 返回即已加载，再额外等待 8t 后执行复制，finally 中删除。
- **结构复制**：`structureManager.createFromWorld` + `place`，保留箱子朝向与内容物 NBT。
- **防重复触发**：仅响应 `isFirstEvent`，并以方块坐标为锁防止并发处理同一位置。
