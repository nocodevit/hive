# Hive Office — Animated Virtual Office Plan

## 概念
俯视角像素风虚拟办公室，agents 在里面走动、工作、喝咖啡、聊天。状态驱动行为。

## 技术栈
- **引擎**: Phaser 3（碰撞、动画、tilemap 内置）
- **美术**: LimeZu Modern Office tileset（$2.50，16x16，300+ 素材）
- **地图编辑**: Tiled 地图编辑器
- **视角**: Top-down 俯视角（Gather.town 同款）

## 参考项目

| 项目 | Stars | 用途 |
|------|-------|------|
| SkyOffice | 1.2k | Gather 克隆，Phaser 3 + React，MIT，最适合 fork |
| pixel-agents | 5.1k | VS Code 扩展，agent 动画状态最贴近需求 |
| WorkAdventure | 5.3k | 最成熟开源虚拟办公室，Tiled 地图 |
| agent-office | - | Agent 走到工位、思考、协作 |

## 角色动画状态
- **Walk**: 4 方向 × 4 帧（上下左右）
- **Idle**: 站立微呼吸（2-4 帧）
- **Sitting/Working**: 坐在工位打字（2-3 帧手臂动）
- **Break**: 走向咖啡机，倒咖啡动画
- **Chat**: 两个 agent 靠近时触发对话气泡
- **Waiting**: 站立 + 头顶 `?` 闪烁

## 办公室元素
- 工位（桌子 + 椅子 + 显示器）
- 咖啡机 / 茶水间
- 白板 / 会议区
- 植物 / 装饰
- 门（进出动画）
- 休息区（沙发）

## 状态驱动行为
```
Agent status: working  → 走到工位坐下，打字动画
Agent status: waiting  → 站起来走动，头顶 ?
Agent status: idle     → 去喝咖啡 / 休息区坐着
Agent task_start       → 走到工位，显示任务气泡
Agent task_done        → 站起来，✓ 动画
```

## 美术素材
- LimeZu Modern Office: https://limezu.itch.io/modernoffice ($2.50)
- LimeZu Modern Interiors: itch.io ($5+)
- 免费替代: https://itch.io/game-assets/free/tag-office
- OpenGameArt: https://opengameart.org
- Gather 兼容 32x32: https://itch.io/c/1904339/gathertown-compatible-32x32-tilesets

## 实现步骤
1. 购买 LimeZu tileset 或用免费素材
2. 用 Tiled 设计办公室地图（18x12 tiles）
3. Phaser 3 加载 tilemap + 碰撞层
4. 角色精灵 + walk cycle 动画
5. 状态机驱动行为（idle → walk → sit → work）
6. 连接 Hive agent 状态数据
7. 集成到 Electron app（Phaser 在 webview 里跑）
