// @ts-check
import { defineConfig } from "@mbler/mfd";

export default defineConfig({
  title: { zh: "移动箱子", en: "Move Chest" },
  mcVersion: { min: "1.26.30", max: "1.26.45" },
  description: {
    zh: `# 移动箱子 (Move Chest)

一个 Minecraft 基岩版模组（行为包 + 资源包）：**整个箱子一起搬走**，带着里面的物品随你移动。

## 仓库

GitHub: [mcbe-movechest-addon](https://github.com/RuanhoR/mcbe-movechest-addon)

## 安装

选择与你的 Minecraft 版本匹配的 \`dist.mcaddon\` 下载后导入游戏即可。
`,
    en: `# Move Chest

A Minecraft Bedrock addon (behavior + resource packs): **pick up chests together** with everything inside and carry them wherever you like.

## Repository

GitHub: [mcbe-movechest-addon](https://github.com/RuanhoR/mcbe-movechest-addon)

## Install

Download the \`dist.mcaddon\` matching your Minecraft version and import it into the game.
`,
  },
  entryAddonManifest: "/assets/manifest.addon.json",
  entryDistAddon: "/assets/dist.mcaddon",
  base: "/move-chest/",
  distEntry: "./dist-page",
  addon: "./dist.mcaddon",
  port: 9527,
});
