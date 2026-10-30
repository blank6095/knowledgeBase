我看完你这次整理的项目全景说明后，觉得需要调整一下之前的设计方向：你不是想把现有知识库的页面做得更漂亮，而是想让“知识图谱”成为整个产品的视觉语言和主要交互入口。

这两件事差别很大。

你已经有今日学习、主动回忆、学习复盘、AI 助手、知识管理等完整功能。现在的问题不是缺少功能，而是这些功能看起来仍然像传统后台系统：侧边栏、卡片、列表、表格，知识图谱只是其中一个独立页面。

我建议把产品重新定义为：

# Knowledge Universe：一个可以探索、感知和操作的个人知识宇宙

它不是传统意义上的知识管理后台，也不应该只是一个带搜索框的力导向图。

它的核心体验应该是：知识以空间的形式存在，用户通过探索、聚焦、连接和观察知识来使用整个系统。

我会保留你现有的业务能力和数据模型，重点重构视觉体系、导航方式和图谱交互。这样 Agent 不需要推翻后端，也不会为了视觉效果破坏已经完成的学习功能。

## 一、我对这套设计的核心判断

你的想法里有三个特别值得保留的方向：

1. 搜索不是跳转到搜索结果列表，而是在图谱中直接定位知识。
2. 图谱不是一张静态关系图，而是可以不断探索、聚焦和操作的知识空间。
3. 视觉主题不只是全站换肤，而是可以改变知识空间的氛围和节点的表现形式。

我会把它们组合成一套设计体系，而不是简单地增加几个开关。

不过，我想先明确一个设计原则：

> 图谱可以有艺术表现力，但不能牺牲知识信息的可读性；可以很炫，但不能让用户看不懂节点为什么亮、为什么暗、为什么彼此相连。

你现在已经用节点亮度表达记忆度、节点大小表达关联数量，使用力导向 Canvas 渲染，并有记忆度过滤、关联类型过滤和双概念联系功能。这个语义体系应该保留，而不是为了视觉效果全部推翻。

project-context.md



我建议采用：

[Knowledge Universe | Devpost](https://images.openai.com/static-rsc-4/Pu6rRCI6pG06Pe4UOMgILLpy1FRfkKTWnlmYVRlmsUBCS6bi7o8gDXe6oEgoYytEQ0_xjv0feGeOZQJ-U7qkCYCr6yn0DQixaFQkg0mh3W9Ljdjryb5YIvgw3d2Jvnr_irtkHVHLHIqKqfMX8CKcKskODyKWwb-r4re0rcQacI0?purpose=inline)

[devpost.com](https://devpost.com/software/knowledge-universe?utm_source=chatgpt.com)

# KNOWLEDGE UNIVERSE

EXPLORE · CONNECT · REMEMBER

一个以知识图谱为中心的空间式交互界面

深色宇宙背景、发光知识节点、动态关系网络、悬浮工具栏、空间聚焦、沉浸式探索。

整体视觉方向我建议是：暗色科技感 + 轻量玻璃拟态 + 数据可视化 + 克制的光效。

不要做成传统后台的深色主题，也不要做成满屏霓虹灯的赛博朋克游戏。前者缺乏特色，后者容易显得廉价且影响阅读。

## 二、整体产品结构：图谱作为首页，而不是一个功能页面

我建议把 `/graph` 从一个普通功能页升级为整个产品的主入口。

用户登录之后，首先看到的不是统计卡片，而是一片完整的知识宇宙。

### 1. 主界面布局

[How I AI (Today): The Contract, the Skills, and the Memory | Hyperbliss](https://images.openai.com/static-rsc-4/b95ynCJ3mmmL1BwVwhyNoKK9SiuUTIpHtgRvAeKLy4TC6muJ3uW2NJixpshj8TFD6zU7bCBTDSJLXry2E_yRWtbv7HkWw7sCWC_gIU2l0_vLqAnUT0oFar18XfFrJdfMukBLsAhbb_dcOlI_PEaKLASqfxaHB6eK6wyOygvxTY4?purpose=inline)

[hyperbliss.tech](https://hyperbliss.tech/blog/2026.05.27_how-i-ai/?utm_source=chatgpt.com)

建议布局如下：

KNOWLEDGE UNIVERSE

知识点 1,286 · 关系 3,642

搜索知识、概念、标签……

Ctrl K

图谱探索空间

自由探索模式

[Metapopulation AI: Modeling Complex Systems with Intelligence](https://images.openai.com/static-rsc-4/KV0tJgMbiS1HeVn9gz5AMv2JHsunI9bM97KEXks7c0JMAQ7Ofn7bQddYRx1SSSB9yBGlLIdGWT0I3gevX1SQ2FWdzn74K9HSox3A2LjfCKHnE3Hds8WvDvZX_22RbKd78uNblSOw6Lom_Ig0ID0V_1ABmkRcOfXiqaztERixff8?purpose=inline)

[skywork.ai](https://skywork.ai/slide/en/metapopulation-ai-complex-systems-2036196574482763777?utm_source=chatgpt.com)

节点：记忆度 / 关联度

缩放 · 拖拽 · 聚焦

底部快捷工具栏

这是结构示意，不是最终页面截图。实际图谱应占据大部分可视区域。

我建议把界面拆成五个层次：

| 层级         | 设计                       | 职责               |
| ------------ | -------------------------- | ------------------ |
| 背景层       | 星空、网格、渐变、粒子纹理 | 建立知识空间氛围   |
| 图谱层       | Canvas 节点和连线          | 核心知识探索       |
| 顶部浮层     | 搜索、知识统计、快捷操作   | 入口与全局操作     |
| 左侧工具栏   | 导航、过滤、图层、主题     | 控制图谱和其他模块 |
| 右侧详情面板 | 节点信息、关系、操作       | 展示当前聚焦知识   |

关键变化：图谱永远是视觉主角，其他 UI 都是围绕它展开的工具。

### 2. 导航方式：从传统侧边栏改为悬浮工具栏

不建议完全取消导航，因为你的知识库、导入、学习复盘、助手等功能仍然需要清晰入口。

但可以将原来的侧边栏收敛成左侧窄工具栏：

知识宇宙

主图谱

搜索知识

知识库

今日学习

学习复盘

AI 助手

外观主题

交互上：

- 默认收起文字，只显示图标。
- Hover 显示中文 Tooltip。
- 点击知识库、今日学习、学习复盘时，可以打开浮层或进入专门页面。
- 点击图谱主入口，回到完整知识空间。
- 右侧详情面板和左侧工具栏互不挤占图谱主体。

我不建议把所有页面都强行塞进图谱画布。比如主动回忆本身需要专注，应该保留独立的沉浸式学习页面，只是导航和视觉语言保持统一。

## 三、最重要的功能设计：图谱搜索与空间聚焦

这是你举的例子，也是我认为最应该优先实现的交互。

### 1. 搜索框应该直接悬浮在图谱上

[Deepnote - Data science notebook for teams](https://images.openai.com/static-rsc-4/eye0AG-t8yy2TiVh-5PDikjoDFfG6whUwkxO5VQGyKckq3qg2H2sZhUPW9rf8U7uxL8EIuJn7VG355Kz-1OsEmreWbStyFm23hAVH6Uda8xetiYJWJzAICgQnpsheQAT1jmamlsFXr-Q_HB1e9qfE_VZiDEuwxKLmPO4DQg9Fyw?purpose=inline)

[deepnote.com](https://deepnote.com/explore/cognee-vs-rag-graph-powered-ai-memory-in-deepnote?utm_source=chatgpt.com)

建议放在顶部中央，宽度约 480–560px，半透明玻璃质感。

搜索时不跳转页面、不覆盖图谱，而是直接改变当前图谱的视觉状态。

### 2. 搜索后的视觉反馈

假设你输入 `React Hooks`：

搜索状态示意

已找到 3 个节点

React Hooks

3 results

匹配节点：高亮

其他节点：弱化

搜索命中节点和关联边高亮，非命中节点降低透明度。此处为视觉示意。

我建议设计成四种视觉状态：

| 元素           | 搜索前   | 搜索后                 |
| -------------- | -------- | ---------------------- |
| 匹配节点       | 正常显示 | 高亮、外发光、轻微放大 |
| 直接关联节点   | 正常显示 | 保留中等亮度           |
| 匹配路径上的边 | 正常显示 | 增强亮度和线宽         |
| 无关节点       | 正常显示 | 降低透明度至约 10%–20% |

这里有一个值得做得更精细的点：

不只是命中的节点变亮，还应该让相关知识形成一个可见的局部网络。

例如搜索 `React Hooks`，可以同时突出：

- React Hooks 本身；
- useState、useEffect 等直接关联知识；
- 与它们关联的 React 生命周期、组件状态等知识；
- 这些节点之间的关系线。

这样搜索不只是“找到一个点”，而是“在知识宇宙中发现一片区域”。

### 3. 搜索结果的交互

建议：

- 输入时实时匹配标题、标签、摘要。
- Enter：聚焦第一个结果。
- 上下方向键：切换结果。
- 点击结果：平滑移动视口，将节点放到画面中心。
- Escape：清除搜索状态，恢复所有节点。
- 点击节点：右侧打开知识详情。
- 点击“展开关联”：将当前节点的一阶或二阶邻居纳入高亮范围。

搜索框下方可以显示结果列表，但只展示标题、标签和匹配原因，不要做成传统的搜索结果页面。

重要的实现原则：搜索过滤只改变图谱显示状态，不要真正删除或过滤掉底层图数据。 否则力导向布局可能发生重新计算，节点位置跳动，破坏空间连续性。

### 4. 搜索的技术实现

你的当前实现是 `react-force-graph-2d`，而且已有 `nodeCanvasObject` 自定义节点绘制。完全可以先用现有技术实现，无须为了这个效果立即换图形引擎。

建议新增一个纯前端状态：

```
type GraphFocusState = {
  query: string;
  matchedNodeIds: Set<string>;
  relatedNodeIds: Set<string>;
  focusedNodeId: string | null;
  isSearchActive: boolean;
};
```

搜索流程：

1. 对现有节点标题、标签和摘要建立前端轻量索引。
2. 用户输入关键词，计算命中节点。
3. 根据 links 计算一阶邻居，必要时支持二阶邻居。
4. 将搜索结果映射到 `nodeCanvasObject` 的绘制状态。
5. 使用 `globalAlpha`、光晕、边框、外圈等实现不同层级的视觉效果。
6. 用 `centerAt()`、`zoom()` 等现有图谱能力完成视口聚焦。

动画建议 250–400ms，避免节点闪烁或过度运动。

搜索结果为空时，不要把整张图谱变成空白。保留原图，并显示“没有找到匹配知识”的提示。

## 四、图谱背景：应该支持切换，而且要有设计体系

我支持你做背景切换，但不建议做成“上传一张图片作为背景”的简单功能。

我更倾向于把它设计成知识空间场景（Graph Environment）。

背景是知识图谱的环境，不是单纯的壁纸。它应该和节点、连线、搜索高亮的颜色形成整体。

### 1. 第一版提供四套场景

[Minimal Dark Space Background / ダーク宇宙のミニマル背景 - NeoAIWorks - BOOTH](https://images.openai.com/static-rsc-4/RvuD96Kv4SaCguAIye2b2IUozU1GrIUSiyTukMIWZ7P1UcwIgCR6NmILrlvirjBOs8iT1wWYtCTGZhK0jT58C24rzSoVVHI5FuULuNXfetB80lSRfdySmmDjX0HANBktIL3d46Gyx00gLFUJ-Wgaxc6TY94PbYbwIBdG61BikGw?purpose=inline)

01 · 深空

默认主题，深蓝黑、微弱星点、蓝色光效。

推荐默认

[Digital Cyberspace with Particles. Technology background](https://images.openai.com/static-rsc-4/RqvufS7-A0OaUDP5Jz9jVIiOCs7Os62VWwgE_T0v7_TPW6DxGB2iPXgynUHoDEZ956VCflUF1LJnRQA66FFx2dMWchFm3X7UbvBs61WfUkBH2aSjVShooBzsOJmSQ_QdAJupf39CPfJ1iJYfPFFJoceccUlrx1mUHI2dNDiEMCUlF2sPkOeKKcZY5vLk7U1Q?purpose=inline)

02 · 数字空间

细密网格、紫青渐变、科技感更强。

[PNG Aurora borealis gradient night | Premium PNG  - rawpixel](https://images.openai.com/static-rsc-4/yVHga9eKP_Zkre4qjOnQJ5yVW9Feou3zLvt0dYyg4YIRFsWMggYrjYwITZU-5d3sjralmqO3DEJy6FY_cguTJlolAwaeOFmmU3smho3Rf_VedsQ_V8tmH3K0hGuh3u-VFbASteHbM2RboyCKTVL6zYJZPdKsSqhXTlUjSwnuekc?purpose=inline)

03 · 极光

青绿渐变、柔和光晕、氛围感更强。

[Black background of paper](https://images.openai.com/static-rsc-4/X92dswO_B9vBWooPQLt-ADeXfJuBJuT0F3LSLHt3fUutm2rLS3N32wgXrDFMjMS_wygNm6OaefYeuvH449luNM7ktG9ffQMFdDl7lfe9Rf6fJpkJetW-cr6b2d_i-GC36AOcFEYoNwUfOd-HUWPKE-DVf2WaE25HLmIR_fXlXoyUQBT3Cq58d0tEcPW5bOj8?purpose=inline)

04 · 极简

纯暗色、轻微噪点、弱装饰，突出知识关系。

我建议默认深空，数字空间作为第二个主题，极光和极简作为补充。

### 2. 背景要分成三层

不要直接将一张大图铺在 Canvas 后面，而是分成：

- 基础底色：CSS 渐变或纯色。
- 氛围纹理：星点、网格、雾状渐变等。
- 图谱画布：节点、边、交互效果。

这样做的优点：

- 切换主题无需重新加载图谱数据。
- 不影响节点布局和位置。
- 可以独立调节背景透明度。
- Canvas 性能更容易控制。

背景第一版不需要动态视频、实时粒子流或复杂 WebGL 特效。静态 CSS 和少量轻量纹理足够有质感。

### 3. 背景主题的可配置参数

```
type GraphEnvironment = {
  id: string;
  name: string;
  background: string;
  texture: "stars" | "grid" | "aurora" | "grain" | "none";
  edgeColor: string;
  accentColor: string;
  mutedOpacity: number;
};
```

主题数据应当集中管理，不要在 `nodeCanvasObject` 和各个组件里散落硬编码颜色。

## 五、节点皮肤：可以换，但我不建议每个节点随意换颜色

这个功能很有创意，不过需要谨慎。

因为你现在的知识节点颜色已经有明确含义：

- 未读：暗灰；
- 微光：记忆度较低；
- 明亮：记忆度中等；
- 长明：记忆度较高。

如果允许每个节点任意选择颜色、发光程度、外观，很容易破坏记忆度编码。

我建议将“节点换皮”拆成两个层次。

### 1. 全局节点风格：第一版必须做

[Abstract geometric connect lines and dots.Simple technology graphic background.Illustration Vector design Network and Connection concept.](https://images.openai.com/static-rsc-4/mi7lUb-Xl1ZMhox13mUaexraLcVjhGCBfHtEiFVaDZr0Cjv7lSgEx7FK76_Z_kkQhtT_s7ytFzT7meGhz-g63aDOawjPeiUfAqE7wetpbwoIwzTvErxmeYuZEUWEJUtznKqElAazS3TJ4Mk29VXLsCJ2j93zW9rcVI3ElgZDhFU95zdPA8L6e-hhXEHlL1TS?purpose=inline)

光点风格

简洁圆形、柔和外发光，适合深空主题。

[Enterprise Architecture Patterns That Actually Work in 2025 | by Ashvini kumar upadhyay | Medium](https://images.openai.com/static-rsc-4/HV-M9QV8v7TH8B5XC7xn4XwIhIG3HvrIyHAs2Y27RGMBdWoRrJ7jN0eU2bApyyttQe3XHbpb_ur3H-gkPIO39JFT1Higcw0S7S9pE-qgej7WL6n3iuF8vJQkxRBhqkWS-9uLOJOA3hHme0NSuA03RrOrcMaxxrttl2OIvwsktq8?purpose=inline)

晶体风格

六边形轮廓、边缘发光，适合数字空间。

[Technology beautiful background. Vector connection and network illustration](https://images.openai.com/static-rsc-4/ZXVqpEkeJczTdU52aVH8Pt871f0OGvph5nrZUcV1rF0KexskAaGUoYETWLyrq2-a2u5dBec2LievYStNe-Msvu9gWDPRefYd5gPGXNUjUeTTg7zKuJnZxqY2Hn3oiRiZN1f6fPGQp4lXeNi76fEW0361TBpNXg-IgOnYUt4tyzVN9guqX-oJ4eIdZsaQ3JR4?purpose=inline)

线框风格

细描边、低光效，适合长时间阅读。

[About — Anautics](https://images.openai.com/static-rsc-4/EhtxQJJFGDFeusSMkKLOXij1gHKwzhQmyxN0SduHCRJU0TGHxxbDAXmPdgVJdtYidcD05BcpfwDs_ZUDPV4jaVTstFFvtLM8gaS4J5zC87kYwSylR3tGo_zj6lFHhL5kcYP7WSCJR-0SKgop6B9O52Qmj7VRt4O4BgmFVOxgcxU?purpose=inline)

能量球风格

更明显的体积光感，适合沉浸探索。

全局节点风格决定形状、描边、光晕和材质感，但不改变记忆度本身的颜色和亮度含义。

例如：

- 节点大小仍然根据关联数。
- 核心亮度仍然根据记忆度。
- 搜索高亮仍然使用主题强调色。
- 节点边框、外圈和光晕可以随风格改变。

### 2. 单节点个性化皮肤：第二阶段再做

我建议保留这个想法，但把它做成“知识标记”，而不是让用户对每个节点自由设计。

例如：

- 给重要知识添加特殊边框。
- 给收藏知识添加星标。
- 给项目核心概念添加皇冠或特殊光环。
- 给某个学习主题设置专属强调色。
- 给自己定义的知识类别设置图标。

[LaunchPad | Devpost](https://images.openai.com/static-rsc-4/9vmMrHtR0Kvm-RULKCb7M_qTeqbDc2JLigpzgmhgk66U8pOpGqBnryxwgBgfokZcUmmFFNzBJZom9-5wXryLpazkqii6m07X0UvcA1HoJNQvwRyvOyan5l05hK40HklYN6XlpvV0wTkYiPt1BQJGqCUa26sJ7BkixCScxO8HYkc?purpose=inline)

[devpost.com](https://devpost.com/software/nethan-binu?utm_source=chatgpt.com)

这样，节点既能保留记忆度信息，又能体现个人知识组织习惯。

如果你确实希望每个节点都能换皮，也可以允许：

- 选择预设节点外观；
- 设置是否收藏；
- 选择自定义强调色；
- 设置特殊图标。

但建议让这些个性化属性只影响节点的外圈、形状或图标，不直接覆盖记忆度颜色。

另外，单节点皮肤需要持久化。可以先采用一个独立的 UI 偏好配置，不要把外观设置混进知识内容、标签或关系数据里。对于你的单用户应用，第一版可以优先使用浏览器本地持久化；如果未来要跨设备同步，再设计服务端偏好存储。

## 六、节点交互：让知识图谱真正成为操作中心

这是整个方案的第二个关键。

我不希望用户点击节点之后就被直接带到 `/segments/[id]`，因为这样会打断探索过程。

建议采用单击聚焦，双击进入阅读的交互。

### 1. 单击节点：右侧展开知识卡片

[Cerebro Dynamics — Software & Technology](https://images.openai.com/static-rsc-4/UqpSFFtDNK6E4bB1qg1VOvVReT0EcZJzindhH-JCbFkUCkhf5BGjh3TdVV37Igj_PuHVEN7xjadKy5qR72gu8_wjVdEOBzUD6GTAbTLbo9Kf3-sdz1En3-__CKan9kMvFqSUjVqqbs_p130fHwSNj6A8oEmMs9LEvalF3wYg_JM?purpose=inline)

[cerebrodynamic.com](https://www.cerebrodynamic.com/?utm_source=chatgpt.com)

右侧详情卡片显示：

- 知识点标题；
- 所属文档；
- 记忆度；
- 关联数量；
- 标签；
- 一句话摘要；
- 直接关联知识。

卡片底部放置三个主要操作：

| 操作     | 行为                     |
| -------- | ------------------------ |
| 阅读知识 | 进入现有知识详情页       |
| 开始复习 | 进入现有主动回忆页面     |
| 展开关联 | 只显示当前知识周边的网络 |

注意：单击选中时，其他节点可以适度降低亮度，但不要像搜索那样全部暗到看不见。

### 2. 双击节点：进入沉浸式知识阅读

双击后进入现有 `/segments/[id]`。

阅读页面可以沿用新的视觉语言：

- 顶部显示知识路径，例如 `Java → 集合框架 → HashMap`；
- 左侧可显示当前知识在图谱中的小型关系缩略图；
- 右侧显示正文、标注和 AI 操作；
- 提供“返回图谱”操作，返回时尽可能恢复原有视口和选中状态。

这样用户在阅读时不会失去自己刚刚探索的知识位置。

### 3. 节点右键：提供快捷操作

建议提供一个轻量菜单：

- 聚焦该节点；
- 展开一阶关联；
- 展开二阶关联；
- 标记为重要；
- 添加到今日学习；
- 进入知识编辑。

移动端没有右键，可以通过长按或详情卡片中的更多操作实现。

### 4. 双节点联系：保留并升级

你现有的“双选联系两概念”功能应该保留。

我建议升级为：

- 先选择第一个节点；
- 再选择第二个节点；
- 两者之间的已有关系路径高亮；
- 如果没有直接关系，则展示它们是否存在间接路径；
- 允许查看两个知识点的关系类型和关联来源。

这会成为很有辨识度的图谱能力。

## 七、其他功能也应该围绕图谱展开

我建议不是把所有业务功能都改成图谱，而是让它们和图谱产生自然联系。

这是我设计的功能关系：

知识图谱 · 核心空间

所有知识的可视化入口

搜索

定位节点、聚焦关系网络

知识阅读

从节点进入原始知识

主动回忆

从薄弱节点直接开始复习

AI 助手

围绕当前节点提问和解释

学习复盘

将薄弱区域映射回图谱

知识导入

新知识加入图谱空间

### 我建议增加四个很有价值的图谱交互模式

| 模式     | 交互方式                                 | 适用场景         |
| -------- | ---------------------------------------- | ---------------- |
| 自由探索 | 显示完整图谱，自由拖动、缩放             | 浏览整体知识结构 |
| 搜索聚焦 | 只突出命中节点及其关系网络               | 查找知识         |
| 局部探索 | 选中一个节点，只突出周围一至二阶关系     | 理解某个概念     |
| 学习地图 | 根据今日推荐、薄弱知识和到期复习突出节点 | 决定接下来学什么 |

其中“学习地图”我认为很有意思。

比如你打开图谱，点击“今日学习”，图谱中就出现三组重点：

- 红橙色：需要优先复习的薄弱知识；
- 蓝色：今日推荐的学习内容；
- 金色：重要的知识枢纽。

但颜色不要直接混用原有记忆度颜色，应该使用外圈、角标、边缘光晕等独立视觉通道。

### AI 助手也应该拥有图谱上下文

在图谱中选中一个知识点，点击 AI 助手时，自动将当前知识点作为上下文。

例如：

- “解释这个知识点。”
- “它与旁边的知识有什么联系？”
- “这个知识点为什么重要？”
- “帮我生成一道关于它的复习题。”
- “找出与它相关但我还没掌握的知识。”

这里不需要重新实现 Agent，只需要让现有 `/ask` 接收并安全校验当前选中的知识 ID，再将该知识上下文纳入对话。AI 提议修改依然遵守项目原来的预览、确认、应用机制。

## 八、前端技术实现架构

结合你现有项目，我不建议重写整个图谱，也不建议现在更换图谱渲染库。

你已经有：

- `react-force-graph-2d`
- `nodeCanvasObject`
- 节点和关系数据接口
- 记忆度和关联度计算
- 过滤和双节点选择
- 图谱压测数据和性能测量脚本

这说明最合理的方向是升级现有图谱组件，而不是推倒重建。

项目全景说明.md



### 1. 推荐的前端组件结构

以下是建议结构，不代表你仓库里已经存在这些组件：

```
src/
├── app/
│   ├── graph/
│   │   └── page.tsx
│   └── ...
├── components/
│   └── graph/
│       ├── KnowledgeUniverse.tsx
│       ├── GraphCanvas.tsx
│       ├── GraphSearch.tsx
│       ├── GraphToolbar.tsx
│       ├── GraphNavigation.tsx
│       ├── GraphDetailPanel.tsx
│       ├── GraphContextMenu.tsx
│       ├── GraphThemePanel.tsx
│       ├── GraphLegend.tsx
│       └── GraphMiniMap.tsx
└── lib/
    └── graph/
        ├── graph-search.ts
        ├── graph-focus.ts
        ├── graph-theme.ts
        ├── graph-style.ts
        └── graph-preferences.ts
```

我建议将职责划分为：

| 模块                   | 职责                             |
| ---------------------- | -------------------------------- |
| `KnowledgeUniverse`    | 组合整个图谱页面，管理界面布局   |
| `GraphCanvas`          | 只负责 Canvas 绘制、节点和边交互 |
| `GraphSearch`          | 搜索输入、结果列表、快捷键       |
| `GraphToolbar`         | 过滤、视图模式、缩放等操作       |
| `GraphDetailPanel`     | 选中节点的信息和操作             |
| `GraphThemePanel`      | 背景、节点风格、主题预览         |
| `graph-search.ts`      | 纯搜索匹配算法                   |
| `graph-focus.ts`       | 节点聚焦、一阶/二阶邻居计算      |
| `graph-theme.ts`       | 主题定义与配置                   |
| `graph-preferences.ts` | 本地偏好保存、读取               |

不必一次拆出所有文件。先读现有 `/graph` 代码，按职责逐步提取，避免为了目录整齐而引入过度抽象。

### 2. 图谱视觉状态应该统一管理

建议将视觉交互状态集中起来：

```
type GraphViewState = {
  searchQuery: string;
  selectedNodeId: string | null;
  focusedNodeId: string | null;

  highlightedNodeIds: Set<string>;
  relatedNodeIds: Set<string>;

  activeMode:
    | "explore"
    | "search"
    | "focus"
    | "learning";

  environmentId: string;
  nodeStyleId: string;

  showLabels: boolean;
  showEdges: boolean;
  edgeTypes: string[];
};
```

这里要区分：

- 业务数据：知识点、关系、记忆度。
- 视觉状态：主题、节点风格、透明度。
- 交互状态：搜索、选中、聚焦、展开。

不要让改变背景主题触发业务 API 请求，也不要让搜索高亮改变数据库数据。

### 3. 性能策略

你现在的设计目标是个人数千知识点，但已有压测覆盖到 8,000 节点，且全量图谱有更大规模的性能风险。

因此：

- 搜索使用本地索引，不在每次输入时请求数据库。
- 节点匹配结果使用 Set，避免绘制时反复遍历数组。
- 节点外发光尽量复用已有 sprite 缓存，不要为每一帧创建大量渐变对象。
- 背景纹理独立于图谱 Canvas 绘制。
- 主题切换不触发力导向重新布局。
- 搜索状态切换不改变 nodes/links 的实际数据。
- 大规模图谱下，标签只显示在合适的缩放级别或被选中时。

还有一点：`react-force-graph-2d` 的 Canvas 绘制能力足以完成第一阶段的设计。只有在性能压测证明现有绘制模型无法达到目标后，才评估 WebGL 或其他方案。

### 4. 偏好设置保存

第一版采用 `localStorage` 保存：

```
type GraphPreferences = {
  environmentId: string;
  nodeStyleId: string;
  edgeStyleId: string;

  showLabels: boolean;
  showMinimap: boolean;

  backgroundIntensity: number;
  glowIntensity: number;
};
```

单节点个性化设置也先使用本地保存：

```
type NodeAppearance = {
  nodeId: string;
  marker?: "star" | "important" | "favorite";
  accentColor?: string;
  shape?: "circle" | "hexagon" | "diamond";
};
```

后续如果确实需要跨设备同步，再增加服务端设置接口。不要为了第一版换肤引入数据库迁移。

## 九、分阶段实施优先级

我建议不要一口气把所有效果都做出来。否则 Agent 很容易生成一个视觉上很炫、但状态混乱、性能差、后期难以维护的图谱页面。

阶段 1 · 图谱空间重构

最高优先级

建议投入 12–16 小时

- 图谱成为登录后的主入口。

- 全屏图谱画布。

- 左侧悬浮导航。

- 顶部悬浮搜索框。

- 右侧知识详情面板。

- 原有功能入口全部保留。
  验收： 进入应用第一眼看到完整图谱，不再是传统统计后台。

  阶段 2 · 图谱搜索与聚焦

  建议投入 8–12 小时

- 实时搜索和结果列表。

- 命中节点高亮、其他节点弱化。

- 一阶邻居保留亮度。

- 视口平滑聚焦。

- Escape 恢复原图。
  验收： 搜索过程不跳页、不重载图谱、不造成布局跳动。

  阶段 3 · 视觉主题系统

  建议投入 8–10 小时

- 四种背景环境。

- 四种节点皮肤。

- 光效强度调节。

- 主题预览与本地持久化。
  验收： 切换主题不重新加载数据、不影响记忆度编码和图谱布局。

  阶段 4 · 高级探索交互

  建议投入 10–14 小时

- 节点详情卡。

- 一阶/二阶关系展开。

- 双节点路径高亮。

- 学习地图模式。

- AI 助手接入当前节点上下文。
  验收： 从图谱可以完成搜索、理解关系、阅读、自测和 AI 辅助，不需要频繁切换到传统列表。

如果每周投入 10 小时，第一阶段和第二阶段可以作为第一轮迭代，第三阶段作为第二轮，第四阶段按实际使用情况逐步完成。

第一轮不要急着实现节点自定义皮肤、粒子动画、3D 图谱。 先把图谱本身做得有辨识度、交互自然。

## 十、可以直接交给 Agent 的实施提示词

下面这份我特意写成了工程实施任务，而不是单纯的 UI 描述。你可以直接复制给 Codex 或其他 Agent。

# Knowledge Universe 前端视觉与交互重构方案

## 1. 项目背景

项目名称：knowledge-base

项目是一个基于 Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、Neon PostgreSQL、Drizzle ORM 的单用户个人知识库。

当前已经具备以下能力：

- Markdown 知识导入、自动拆分和关联。
- 知识点详情、连续阅读、标注和笔记。
- 基于记忆度的节点亮度表达。
- 力导向知识图谱。
- 今日学习、主动回忆、学习复盘。
- AI 知识库助手和 AI 知识编辑。
- 图谱搜索、记忆度过滤、关联类型过滤、双节点关联选择等已有能力。

当前图谱技术：

- `react-force-graph-2d`
- Canvas 自定义 `nodeCanvasObject`
- `/api/graph` 提供 nodes 和 links
- 现有图谱性能优化包括属性预计算、warmup、sprite 缓存等。

当前任务不是增加大量业务功能，而是对前端视觉体系、导航结构和知识图谱交互进行系统性重构。

## 2. 核心设计目标

将知识图谱升级为整个产品的核心入口，打造：

**Knowledge Universe —— 一个可以探索、感知和操作的个人知识宇宙。**

设计方向：

- 深色科技感。
- 深空、数字网络、知识星图等视觉隐喻。
- 适度玻璃拟态。
- 柔和发光节点。
- 精细关系连线。
- 空间式交互。
- 悬浮工具栏。
- 沉浸式知识探索。

禁止做成传统后台管理系统。
禁止只通过换颜色、加阴影和圆角来完成所谓的视觉重构。
禁止为了视觉效果破坏现有业务功能。

设计参考方向为高品质数据可视化、知识网络、科学可视化和未来科技产品，不要做成廉价赛博朋克游戏界面。

## 3. 目标页面结构

将 `/graph` 升级为 Knowledge Universe 主界面。

默认登录后优先进入知识图谱。

页面采用全屏空间布局：

### 背景层

- 深空背景。
- 可切换数字空间、极光、极简背景。
- 背景与图谱 Canvas 分离。
- 背景切换不能触发图谱数据重新加载或力导向重新布局。

### 图谱层

- 占据主要屏幕空间。
- 继续使用现有 `react-force-graph-2d`。
- 保留节点大小与记忆度编码。
- 保留现有关系类型。
- 优化节点、连线、标签和选中态的绘制效果。

### 顶部区域

- 左上角产品标识 Knowledge Universe。
- 顶部中央悬浮搜索框。
- 右上角显示知识点数量、关系数量等轻量信息。
- 搜索框支持 Ctrl+K / Cmd+K 快捷键。

### 左侧区域

使用窄型悬浮导航，不再采用传统宽侧边栏。

导航入口：

- 知识宇宙
- 知识库
- 今日学习
- 学习复盘
- AI 助手
- 外观设置

默认只显示图标，悬停展示中文 Tooltip。

### 右侧区域

点击图谱节点后展示知识详情面板，不应立即跳转页面。

显示：

- 知识点标题
- 所属文档
- 记忆度
- 关联数量
- 标签
- 摘要
- 直接关联知识

操作：

- 阅读知识
- 开始复习
- 展开关联
- AI 解释
- 编辑知识

双击节点进入现有知识详情页。

## 4. 图谱搜索与聚焦

这是最高优先级的核心交互。

搜索框悬浮在图谱上方，支持：

- 标题搜索
- 标签搜索
- 摘要搜索
- 实时搜索
- 结果列表
- 键盘上下选择
- Enter 聚焦结果
- Escape 清除搜索

搜索后：

1. 匹配节点高亮。
2. 匹配节点增加柔和外发光。
3. 直接关联节点保持中等亮度。
4. 无关节点降低至约 10%–20% 透明度。
5. 相关连线增强亮度和线宽。
6. 视口平滑移动至匹配节点。
7. 支持切换不同搜索结果。
8. 搜索无结果时保留完整图谱并显示友好提示。

搜索不应改变底层 nodes/links 数据，不应触发力导向布局重算。

使用 Set 存储匹配节点和关联节点 ID，避免 Canvas 绘制时反复执行复杂查询。

搜索动画建议 250–400ms。

## 5. 图谱交互模式

提供以下模式：

### 自由探索

完整图谱，自由缩放、拖动、浏览。

### 搜索聚焦

突出搜索命中节点和关系网络。

### 局部探索

选中一个节点后突出其一阶或二阶关联知识。

### 学习地图

突出今日推荐、到期复习、薄弱知识。

学习地图不能覆盖记忆度本身的颜色含义，优先使用外圈、角标、边缘光效等额外视觉通道。

### 双节点联系

保留现有双选联系功能：

- 选择两个节点。
- 高亮两者之间的关系。
- 展示关联类型。
- 若无直接边，检查是否存在间接路径。
- 不修改原始关系数据。

## 6. 背景主题系统

第一版提供四种主题：

1. 深空：深蓝黑、星点、柔和蓝光。
2. 数字空间：深色网格、紫青色光效。
3. 极光：青绿渐变、柔和雾状纹理。
4. 极简：纯暗色、轻微噪点、低装饰。

背景分层：

- CSS 基础底色。
- CSS 纹理或轻量静态背景。
- 图谱 Canvas。

禁止第一版引入视频背景、重型粒子引擎或 WebGL 特效。

## 7. 节点皮肤系统

第一版提供四种全局节点风格：

1. 光点：圆形、柔和外发光。
2. 晶体：六边形轮廓。
3. 线框：细描边、低光效。
4. 能量球：更明显的体积光感。

节点皮肤只改变：

- 形状
- 描边
- 外圈
- 光晕
- 材质表现

必须保留：

- 节点大小 = 关联数量或现有度数逻辑。
- 节点核心亮度 = 记忆度。
- 搜索高亮 = 当前主题强调色。

不能让皮肤设置覆盖记忆度语义。

单节点个性化先只实现收藏、重要标记、特殊边框或图标，不急于开放任意外观编辑。

## 8. 主题与偏好持久化

第一版使用 localStorage 保存：

- 背景主题 ID。
- 节点风格 ID。
- 边线风格。
- 标签显示状态。
- 小地图显示状态。
- 背景强度。
- 光效强度。

主题切换不请求业务 API。

单节点外观也先保存在本地，后续确有跨设备需求再考虑服务端同步。

必须处理 localStorage 不可用、无效配置和配置版本升级的情况。

## 9. 技术架构建议

建议逐步拆分组件，但不要为了目录整洁而过度重构：

- KnowledgeUniverse：主界面容器。
- GraphCanvas：图谱绘制和交互。
- GraphSearch：搜索和结果列表。
- GraphToolbar：过滤和视图控制。
- GraphNavigation：左侧导航。
- GraphDetailPanel：节点详情。
- GraphThemePanel：主题配置。
- GraphContextMenu：节点快捷操作。
- GraphLegend：图例。
- GraphMiniMap：可选小地图。

建议提取纯逻辑模块：

- graph-search.ts
- graph-focus.ts
- graph-theme.ts
- graph-style.ts
- graph-preferences.ts

集中管理主题配置，不要在各个组件中散落颜色常量。

## 10. 重要工程约束

必须遵守仓库 AGENTS.md：

1. 修改 Next.js 16 相关代码前，先读取 `node_modules/next/dist/docs/` 对应指南。
2. 零新增依赖优先。
3. 现有 API、数据库、学习功能和 AI 功能尽量复用。
4. 不允许无必要地修改业务数据模型。
5. 不允许改变记忆度算法和既有语义。
6. 不允许破坏原有图谱节点点击、拖动、过滤、双节点关联等功能。
7. 主题设置与业务数据分离。
8. 所有交互必须有明确的加载、空状态、错误状态和移动端适配。
9. 不要一次性重写整个项目。
10. 修改后运行 lint、typecheck、test、build 和必要的 E2E。

性能约束：

- 不在 Canvas 每帧创建大量对象或重复计算。
- 复用已有 sprite 缓存。
- 背景绘制与图谱绘制分离。
- 搜索状态变化不能导致节点重新布局。
- 主题切换不能重新请求图谱数据。
- 保留现有压测入口，至少验证 500、5000、8000 节点。
- 大规模数据下按缩放级别控制标签显示。

## 11. 实施顺序

不要一次性实现所有功能。

第一批：图谱主界面重构

- 全屏图谱。
- 悬浮导航。
- 顶部搜索。
- 右侧详情面板。
- 现有功能入口迁移。

第二批：搜索和聚焦

- 实时搜索。
- 命中节点高亮。
- 非命中节点弱化。
- 邻居高亮。
- 视口平滑聚焦。
- 键盘交互。

第三批：主题系统

- 四种背景。
- 四种节点风格。
- 主题设置面板。
- localStorage 持久化。

第四批：高级探索

- 局部探索。
- 双节点路径。
- 学习地图。
- AI 当前节点上下文。

每一批独立完成、测试和验收，再开始下一批。

## 12. 验收标准

### 视觉验收

- 登录后第一眼是知识图谱，而不是传统统计卡片。
- 图谱占据页面主要空间。
- 视觉风格统一，具有明显辨识度。
- 搜索框、导航、详情面板与画布协调，不遮挡核心节点。
- 不出现传统后台模板式大面积卡片堆叠。

### 交互验收

- 搜索可以高亮匹配节点。
- 非匹配节点明显弱化。
- 邻居节点与关联边有层次化表现。
- 搜索结果可以平滑聚焦。
- Escape 可以恢复完整图谱。
- 点击节点打开详情面板。
- 双击可以进入知识详情。
- 主题切换立即生效。
- 刷新页面后恢复用户偏好。

### 回归验收

- 原有记忆度颜色语义不变。
- 原有节点大小语义不变。
- 原有过滤、拖拽、双节点关联正常。
- 今日学习、主动回忆、学习复盘、AI 助手仍可正常使用。
- 现有数据和 API 不被破坏。

## 13. Agent 执行方式

首先阅读：

- AGENTS.md
- 项目全景说明.md
- docs/spec.md
- docs/graph-performance-plan.md
- docs/ux-optimization-plan.md
- 当前 `/graph` 页面及相关组件
- 当前 `nodeCanvasObject` 实现
- 图谱相关测试

先输出：

1. 当前图谱前端架构分析。
2. 现有组件可以复用的部分。
3. 需要修改和新增的文件。
4. 可能影响现有功能的风险。
5. 第一批实现计划。

然后只执行第一批，不要提前实现所有阶段。

第一批完成后：

- 展示真实运行页面截图。
- 说明修改文件。
- 汇报测试结果。
- 汇报仍未完成的事项。
- 等待验收后再进行下一批。

最终目标是打造一个真正以知识图谱为核心的沉浸式知识探索产品，而不是给传统后台换一套深色皮肤。

## 十一、我还想特别强调三个设计取舍

这三个取舍会决定最后的成品是高级还是花哨。

第一，图谱是主角，但不是所有信息都必须变成节点。

比如学习复盘、知识编辑和 AI 对话，不必全部画成节点。它们是操作知识的工具，图谱负责提供上下文和入口。不要为了“万物图谱化”牺牲使用效率。

第二，节点皮肤要有边界。

背景可以大胆变化，节点可以有多种外观，但记忆度的含义必须稳定。这是你这个产品最有辨识度的特征之一。用户应该一眼看出哪些知识正在遗忘，而不是每次切换皮肤都需要重新学习颜色含义。

第三，先把 2D 图谱做到极致，再考虑 3D。

你现在用的 Canvas 力导向图已经有不错的性能基础。3D 看起来更炫，但会增加遮挡、视角控制、标签可读性和性能成本。对于知识探索来说，清晰的 2D 空间交互比一个漂亮但难用的 3D 球体更有价值。

我的最终建议：先把第一阶段和第二阶段做到让你自己满意，再做主题系统。 如果一打开页面，你就能看到知识网络，输入一个概念就能让整片相关知识亮起来，点击节点就能顺着关系继续探索——那时这个项目才真正拥有了区别于普通知识库的前端体验。

接下来最值得做的一步，是让 Agent 先实现第一批，并要求它提供真实运行截图。你可以拿截图判断整体风格是否对味，再决定第二轮的视觉细节。
