# R14 — 连接器端点绑定（流程图/时序图共享底座）

> 状态：**已实现**（0.2.5，2026-09-17）。原始草稿动机与取舍保留如下；收束版已写回
> `.design/requirements.md`（§5 划线，R14 章节 + §7 状态行）并更新
> `.design/requirements-mapping.md`。提出方：项目自身路线图（2026-09-17，流程图/时序图
> 需求讨论，四档分层中的 Tier B；Tier C 结构化图表对象、自动布局另立项）。

## 实现与证据

- 类型：`EndpointBinding` + `LineData.start?/end?`（`packages/core/src/types.ts`；可选字段，
  缺失 = 自由端，不升 SCENE_VERSION——strokeStyle 先例）。
- 纯助手：`nearestAnchor` / `snapEndpoint` / `resolveAnchorWorld` / `boundArrowOps` /
  `stripBindingOps`（`packages/konva/src/binding.ts`，零 Konva 导入）。
- 创建吸附：`packages/konva/src/tools/shape.ts`（8 屏幕 px，取全场景最近盒周）。
- 提交路径：`packages/konva/src/editor.ts`（`commitTransform` / `deleteSelection` /
  `applyStyleToSelection` / `commitText` 同事务追加 `boundArrowOps`/`stripBindingOps`；
  瞬态 `updateBoundArrowsTransient` 挂 transformer `transform` 事件）；`tools/select.ts`
  （拖拽瞬态 + `commitDrag`）、`tools/eraser.ts`（同事务剥离）。
- 验收：`tests/unit/binding.test.ts`（27 测试）+ e2e `aj`（36 检查全绿）。
- 实现中确认的语义：落笔在盒**内部**时吸附到对应的内部锚点（"从框内起笔的箭头"跟随框），
  测试固化为预期行为。
- 延后不变：端点重拖拽（+1–2 天，纯增量，只消费本层助手）。

## 为什么需要

流程图与时序图有一个共同的承重墙：**连线跟随图形**。今天 `shape.arrow` / `shape.line`
只是两点折线——移动一个矩形，搭在它上面的箭头就留在原地断裂。没有这个能力，任何图表
功能都只能是"生成一次、不可维护"的静态拼贴；有了它，图形与连线的日常编辑（拖动、
缩放、改文字）才成立。线型（0.2.3）与字体字号菜单（0.2.4）已经让"画出一张流程图"变得
很容易，绑定是让"维护一张流程图"成立的最后一块运行时原语。

`requirements.md` §5 曾把 "arrow binding to shapes" 列为明确非需求；本次按 AGENTS.md
规矩提升为 R14（§5 划线，仿 O1/O2 先例）。

## 核心架构决策：提交时推导（points 为真相）

存储的 `points` 永远是对渲染、PNG 导出、只读投影、wire 同步都成立的唯一真相；绑定只是
`LineData` 上的**可选编辑元数据**（`start?` / `end?`，归一化锚点）。每次几何提交在**同一
事务内**用纯函数为受影响箭头重算端点并派发 `points` 补丁：

- 渲染器 / 导出 / viewer / 命中测试 / `applyDelta` **零改动**；
- 一次手势 = 一步撤销（I9）：框与箭头补丁同事务，undo 同回；
- 只读（I11）结构安全：所有推导点都在既有 mutator 内；
- 被绑定 id 缺失 → 推导 no-op，箭头保持最后位置；
- 走 `strokeStyle` 附加式先例：**不升 SCENE_VERSION**。

被否决的备选：渲染时推导（渲染器需要失效索引、分裂"渲染的"与"文档的"，且导出/同步仍
需提交时写入，两头付费）。

## 完成判据

1. `LineData` 增加 `start?: EndpointBinding; end?: EndpointBinding;`（`EndpointBinding =
   { id: Id; x: number; y: number }`，锚点基于被绑定图形**未变换**盒的归一化 0..1 坐标；
   缺失 = 自由端）。
2. 创建时吸附绑定：箭头/线手势的端点落在可绑定图形（rect / ellipse / text）盒周 8px
   （世界单位，按 viewport.scale 换算）内 → 吸附到盒周最近点并记录绑定；否则为普通箭头。
3. 绑定跟随：被绑定图形发生移动 / 缩放 / 旋转 / 文本盒重测量（字号 restyle、文本编辑）
   时，连线的对应端点在同一事务内重算并提交；拖动与 transformer 手势期间有瞬态跟随。
4. 删除解绑：删除被绑定图形时，幸存连线的绑定字段在同一事务内剥离（连线保持最后位置）；
   删除的一步撤销同时恢复图形与绑定（jsonpatch 的 remove 逆转为 add 原值）。
5. `freehand.stroke` 永不绑定；`shape.line` 与 `shape.arrow` 共享绑定字段。

## 验收

**单元**
- `resolveAnchorWorld`：平移 / 旋转（90°、30°）/ 缩放 / 组合，对手算值；
- 吸附：近边 → 归一化锚点；远 → null；两盒取最近；line / freehand 不可绑定；
- `boundArrowOps`：纯移动 / 缩放烘焙 / 旋转 / 两端同图形 / 两端各绑一图形同调用 /
  多点线只补首末对 / 目标缺失 → 无 ops；
- `stripBindingOps`：删一端留另一端、未绑定不动、同删箭头不被引用；
- store 集成：一事务 = 一条 undo 且同时恢复框与箭头点；删的 undo 恢复绑定；
- 序列化往返保留 `start` / `end`（无校验器改动、无迁移）。

**页面级（e2e `aj`）**
- 从矩形边线起笔的箭头自动绑定（`data.start.id`、锚点 ≈ (1, 0.5)）；
- 拖框 → 箭头存储起点 = 移动后框上的重算锚点，自由端不变；
- 一次 Ctrl+Z 同时恢复框与箭头点；
- transformer 缩放 → 箭头端点跟随新边；
- 删除矩形 → 箭头幸存、`data.start === undefined`、points 逐字节不变、undo 恢复绑定；
- 场景 JSON 往返后绑定仍驱动箭头。

## 明确的取舍与不做（本层）

- **混版 peer**：旧版本端移动被绑定图形时不重推导，接收端箭头视觉停滞至同版本端再动
  该图形。宿主部署模型下（运行时随宿主 bundle 发布，一个房间一个构建；混版只存在于
  滚动发布的数秒）可接受；在远端应用路径上补推导会产生机器生成的 undo 条目与回环流量，
  拒绝。待真实传输需求出现时再议。
- **duplicate 保持指向原图形**：复制箭头时 `start.id` 仍指原框（复制"框+箭头"不会把
  箭头副本重指到框副本）。tldraw 同款行为，可接受。
- **创建吸附会修正落笔最多 8px**（有意：绑定即时可见，静止时存储点 = 推导点）。
- **端点重拖拽**（拖动既有箭头的一端重新绑定/解绑）不在本层：现有工具无单端点手势，
  后续 +1–2 天，纯增量，只消费本层助手。
- **绑定到另一条线/箭头**：Tier B 绑定只面向盒类图形。
- 无新 chrome 键、无 UI 文案（行为对用户的呈现就是"线跟着框走"）。

## 宿主侧的其余职责（不是本需求）

图表的**领域语义**（流程图节点类型、时序图参与者/消息语法、自动布局）属于 Tier C 的
结构化图表对象或宿主自己的生成器；本需求只提供"连线跟随图形"这一运行时原语。
