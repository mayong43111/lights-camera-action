# 灯光、摄影、开拍：Unity Web 验证

当前目标：在本机 VS Code + Unity 中跑通真实人物创建与单人物摄影棚，再构建到浏览器。不是 Three.js 项目，也不迁移旧 FK/IK 实现。

## 当前状态

- 本机：Windows 11 ARM64，Snapdragon X Elite X1E80100，约 32 GB RAM，Adreno X1-85。
- 已安装并核实：Unity Hub 3.21.3 ARM64；VS Code Unity 扩展。
- Unity Personal 已通过实际批处理启动验证。
- 已安装 Unity 6.6 / 6000.6.3f1 ARM64，修订号 45d8eee7de74，以及对应 Web Build Support。
- 已建立：Unity 工程骨架、固定包版本、UMA 下载校验与 Editor 启动脚本。
- 官方 UMA31_f1.unitypackage 已校验并导入；初始化、导入与自有配置入口的批处理退出码均为 0。
- 已生成独立创角场景副本、URP 设置和资源库；配置检查确认 1 个人物入口和 1 台相机。
- Web 构建已通过，用户已确认浏览器中出现人物。默认 UI Shader 裁剪问题已修复。
- 已用应用自己的中文 Runtime UI Toolkit 工作台替换官方示例面板，保留 UMA 人物和摄影棚；旧 Canvas 与 uGUI EventSystem 已停用。
- 已通过真实浏览器点击验证：参数滑杆、分组随机、保存、重置、恢复，以及刷新页面后的完整存档恢复。最后一次保存和重载检查没有浏览器警告、页面异常或 WebGL 上下文丢失。
- 已扩展为基础、体型、五官、发型、穿搭五步创角；真实点击验证了男女切换、上衣/下装/鞋履/发型替换、发色修改及跨性别恢复旧存档。切换性别返回时，原人物完整配方一致。
- 人物区域支持按住鼠标左键拖拽旋转；已验证朝向改变、外观配方不变，以及松手后继续移动不再旋转。
- 已检查 1100 × 664 桌面及 390 × 844 窄屏布局，均为左右两区；窄屏五官子类可点击，主要控件未越界，检查到的文本没有横向溢出。没有使用截图；每件资源的人工视觉验收和真实移动设备性能仍需单独进行。
- 当前是创角与单人物摄影棚原型，不是最终摄影工作台；开发构建约 469 MB，资源裁剪与加载优化尚未进行。

## 中文人物工作台

页面标题、加载状态、操作按钮和人物参数均为中文。左侧只放分类、选项卡与参数；名称位于人物区域底部中央，上一步、下一步、随机、重置、恢复、保存集中在右上角。参数只显示滑杆，不显示数值输入框。已移除网页底栏、全屏按钮、影棚标题栏和朝向工具条。人物默认静止，自动表情与附加骨骼摆动保持暂停；鼠标左键拖拽仍可旋转。默认静止时，五官与发型步骤自动靠近头部，其余步骤显示全身。

右侧竖排姿势栏按顺序提供“静止”、固定姿势“放松 / 平举 / 迈步”和动态“待机 / 行走 / 跑步”。固定姿势为现有人形动画的定格采样，运动原地循环，不应用根运动位移；选择非默认状态时自动显示全身，并为姿势栏预留镜头空间。换装、捏脸、恢复外观或切换性别后保留当前姿势选项。姿势属于本次会话的预览状态，不写入角色外观存档；重新加载后默认静止。

姿势复用 UMA 包内的 Chal_Idle、UMA_APose、UMA_TPose、Chal_Walk 和 Run 动画，由应用自己的 Animator Controller 驱动，不修改第三方资源。七个选项的真实点击、四种定格状态的区分与稳定、三个完整运动周期、停止播放、原地位置、换装后续播、性别切换及桌面/窄屏竖栏布局均已通过无截图测试；姿势操作不改变外观配方、左栏重建次数或滚动位置。

| 步骤 | 内容 |
| --- | --- |
| 基础 | 女性/男性、14 个外观预设（女性 6 个、男性 8 个）、由浅至深的连续自然肤色滑杆 |
| 体型 | 整体、躯干、手臂、腿脚；支持本组参数随机 |
| 五官 | 脸型、眼睛、眉毛、鼻子、嘴唇、下颌、耳朵、妆容；支持局部预设卡片和参数微调，另有眉毛资源款式及 9 种瞳色 |
| 发型 | 发型、11 种发色、胡须 |
| 穿搭 | 上装、下装、鞋履、上身内搭、下身内搭 |

资源目录来自官方 UMA 示例，按当前人物的兼容种族筛选；运行时女性可用 82 个、男性可用 100 个穿戴项（含发型、眉毛、胡须、面部和服装）。同一槽位单选替换，“不使用”与其他资源采用相同网格卡片；有缩略图的资源使用真实缩略图。不支持的参数不会生成滑杆。步骤可直接点击，也可使用上一步/下一步。

局部预设从当前性别的已有官方预设提取，仅应用当前分类中受支持的 DNA 参数，不改变其他五官、衣服或颜色；相同参数组合合并。卡片使用来源角色的真实头像，并非当前人物套用后的实时效果图。应用外观、局部预设、换装或颜色时，只原位更新左栏选中状态和参数，保留列表与滚动位置；主动切换分类或性别时才重建对应内容。

本次会话内切换性别会保留各自的编辑快照；应用外观预设会替换当前人物外观。只有当前人物会写入单一存档，性别切换缓存不会跨浏览器刷新保留。

“保存”使用 Unity PlayerPrefs 存储完整 AvatarDefinition；“恢复”读取本浏览器的单一角色槽。“重置”回到本次页面加载完成时的人物外观，不删除已保存角色。人物生成或参数等待应用期间，保存和恢复不可用。打开肤色分类不会重写原肤色；拖动后才应用自然色系，并保留原材质的其他通道与属性。

附加摆动骨骼由应用侧 [StudioSwayBoneAnimator.cs](UnityStudio/Assets/Studio/Runtime/StudioSwayBoneAnimator.cs) 检查：每个人物使用独立运行时配置，仅初始化当前骨架中存在的链，不修改 UMA 源码或资源。实际男女双马尾换装检查中，各跳过两条缺失锚点链，而非补建缺失骨骼。有效链仍使用 UMA 原有实现，但创角页面统一暂停其更新，以保持人物静止。

当前目录没有明确标识为亚洲人物的预设；不将现有参数随意标记为族裔。后续可在当前骨架上制作经过美术验收的多样外观预设，或引入明确兼容 UMA 3、URP 和 Web 的授权资源。调研到的 [o3n Male and Female UMA Races](https://assetstore.unity.com/packages/package/102187) 页面标注不支持 URP，未导入或验证。

最新无截图回归覆盖空闲与换装后的静止姿态、脸型/眼睛局部预设隔离、实际眉毛卡片应用、左栏重建次数与滚动位置不变、“不使用”卡片选中状态、底部名称和右上角操作布局，以及肤色、随机/重置、男女发型与双马尾切换、拖拽释放。1100 × 664 / 390 × 844 均通过；当前女性目录包含 5 个不同脸型组合、6 个眼睛组合和 16 款眉毛资源。UMA 3 的新式 DynamicExpressionPlayer 独立于旧表情播放器，二者都需暂停，才能消除自动视线和表情变化。

集成浏览器自动化工具不可用时，使用独立无头 Edge 上下文验证，不触碰用户存档。[Test-CharacterWorkbench.cjs](scripts/Test-CharacterWorkbench.cjs) 可重复执行：第一个参数为本机 Playwright 模块路径，第二个参数为预览 URL；需要 Node.js、Playwright 和 Edge。缺失站点图标的 `/favicon.ico` 404 单独报告，其他浏览器错误会使测试失败。

存档属于当前浏览器及站点来源，不是项目文件导出，也不跨设备同步。更换本地端口、浏览器配置或清理站点数据可能导致无法读取原存档。再次打开页面后，点击“恢复”载入已保存角色。

[CharacterSession.cs](UnityStudio/Assets/Studio/Runtime/CharacterSession.cs) 管理人物生成与配方往返；[CharacterWorkbench.cs](UnityStudio/Assets/Studio/Runtime/CharacterWorkbench.cs) 和 [Workbench.uss](UnityStudio/Assets/Studio/UI/Workbench.uss) 实现工作台；[中文 Web 模板](UnityStudio/Assets/WebGLTemplates/StudioChinese/index.html) 是页面外壳源文件，不直接修改构建产物。

已随项目打包 Noto Sans CJK SC 中文字体和[原始 SIL 字体许可](UnityStudio/Assets/Studio/UI/NotoSansCJK-LICENSE.txt)。运行时检查确认 UI 文字使用该字体，不依赖浏览器所在电脑的字体。开发构建包含只读状态诊断：调用 `unityInstance.SendMessage("Studio Workbench", "Inspect", "")` 后，通过浏览器的 `studio-state` 事件读取参数、控件边界、字体和网格状态；正式构建不包含诊断方法。

## 单人物摄影棚

创角左栏标题旁的“摄影棚”进入第二页；“编辑人物”返回。两页共享同一个 UMA 人物实例，保留名称、外观和服装，不复制或重新生成人物。摄影棚首次进入默认静止，再次进入保留摄影棚内的摆姿；返回创角页也不恢复动态播放。创角面板仅隐藏，返回时保留当前分类和滚动位置。

- 取景：全身、半身、特写；镜头视角滑杆；左键拖拽环绕镜头，滚轮调整距离，支持重置视角。摄影棚拖拽不改变人物朝向。
- 人物：静止、瑜伽山式、上举、幻椅、战士一式、树式、芭蕾燕式和二位八种定格；提供左右镜像、重置当前姿势，以及躯干、头颈、左右臂、左右腿六组共 32 个关节肌肉滑杆。
- 布光：独立主光、补光、轮廓光强度滑杆，使用三盏真实聚光灯；默认强度 4.5 / 1.8 / 3.5，上限 10，相比初版降至十分之一；应用 URP 管线启用附加灯阴影。
- 背景：浅灰、深灰、薄荷绿，作用于应用生成的弧形背景棚材质。

进入时暂停显示原创角环境及其灯光，离开时恢复原有可见性、环境光和相机设置；进入及调整姿势时根据实际变形后的网格边界对齐棚底和取景。镜头、摆姿、灯光与背景设置只保留在本次会话，不写入角色存档。本轮不包含多人、三维 IK 拖拽、照片导出或第三方人物模型扩展。

[PhotoStudioPage.cs](UnityStudio/Assets/Studio/Runtime/PhotoStudioPage.cs) 管理摄影棚界面与镜头；[PhotoStudioSet.cs](UnityStudio/Assets/Studio/Runtime/PhotoStudioSet.cs) 管理自有棚景及灯光，不修改 UMA 资源。开发诊断提供当前页面、人物实体标识、棚景顶点数、实际灯光强度、背景材质颜色与相机状态，供无截图交互测试使用；这些检查不替代人工画质验收。

[StudioPoseRig.cs](UnityStudio/Assets/Studio/Runtime/StudioPoseRig.cs) 使用 Unity 自带的 HumanPoseHandler 与 Humanoid 肌肉通道，暂停 Animator 后应用定格，避免每帧动画覆盖手工调整。动作参考 `origin/refactor/typescript-react-antd` 分支的 `assets/poses/library.json` 中山式、上举、幻椅、战士、树式和燕式；旧库是 VRM 归一化骨架的弧度制局部旋转，因此本版重新适配为 Unity 人形肌肉值，并新增芭蕾二位，不直接套用旧骨架轴。预设仍需人工检查动作规范、服装穿插与人物比例差异，不视为专业动作教学示范。

静态摆姿 Web 构建及真实 Edge 回归已通过：8 个不同定格持续稳定、山式垂手/上举抬手/树式抬脚的骨骼位置、六组微调、左右镜像与双次镜像还原、重置和再次进入保留微调、默认灯光与强度上限、取景和镜头、1100 × 664 / 390 × 844 布局及原有创角回归。测试使用实际菜单项点击、运行时骨骼及网格状态，不使用截图；没有应用错误或警告，缺失站点图标的 404 单独记录。未进行人工画质、专业动作规范或真实移动设备性能验收。

## 1. 安装与激活

使用 **Unity 6.6 / 6000.6.3f1 / Windows ARM64** 和同版本 **Web Build Support**，本机已经安装且 Personal 许可证已经通过 CLI 启动验证。不需要为了本项目另装 Visual Studio IDE；VS Code 已装 Unity 扩展。

本地安装包已经下载，可依次运行 [ARM64 Editor 安装包](Downloads/UnitySetupArm64-6000.6.3f1.exe) 和 [Web 模块安装包](Downloads/UnitySetup-WebGL-Support-for-Editor-6000.6.3f1.exe)，Web 模块须安装到刚安装的同版本 Editor。两个安装包的 Unity 数字签名均已核验有效，权限清单为 `highestAvailable`，安装及可能出现的 UAC 确认由用户在本机执行。解压、缓存、项目 Library 和 UMA 还需要额外空间。登录信息和许可证密钥不要发到聊天中。

Unity 支持原生 ARM64 Editor，但并不保证所有第三方二进制和 Web 工具链在该主机上都可用。使用 D3D11，不选择 Windows ARM 上不受支持的 Vulkan；必须通过真实构建确认 Web 支持。

本机实际路径为 `C:\Program Files\Unity 6000.6.3f1\Editor\Unity.exe`。脚本自动检查 Hub 和独立安装器的默认目录；其他位置可设置环境变量 `UNITY_EDITOR` 或通过脚本的 `-UnityEditor` 参数传入。

## 2. CLI 初始化与导入

在仓库根目录运行：

```powershell
.\scripts\Test-UnityEnvironment.ps1
.\scripts\Get-UmaPackage.ps1
.\scripts\Open-UnityStudio.ps1 -ImportUMA
```

本机已经完成上述导入，不必每次重复执行。运行 [scripts/Open-UnityStudio.ps1](scripts/Open-UnityStudio.ps1) 默认使用 `-batchmode -quit`，等待完成并检查退出码；不会打开桌面 Editor。只有显式传入 `-Interactive` 才启动界面。

VS Code 的任务入口为 `Terminal > Run Task`，其中 `Unity: Check Environment` 检查安装条件，`Unity: Validate Project (CLI)` 执行批处理初始化。日志默认写入被 Git 忽略的 `Logs` 目录；可通过 `-LogPath` 指定每步日志。日志可能包含本机信息，不直接公开上传。

使用官方 `V3.1f1` 发布的 `UMA31_f1.unitypackage`，下载约 1.17 GB；脚本对照 GitHub 发布元数据中的 SHA-256 校验。暂不安装旧 UMA2 内容或额外头发样例。包和导入的第三方大文件不提交到 Git，恢复工程时重新下载导入。UMA 自身的运行时资源清单必须由其工具正确建立，不能以 Git 忽略规则代替构建资源管理。

[UnityStudio/Packages/manifest.json](UnityStudio/Packages/manifest.json) 保留 URP 17.3.0 与选定 UMA 发布所需包，没有引入 HDRP、Animation Rigging 或 AI 包。Editor 端导入和配置编译已通过；Web 编译与 GPU 运行仍需各自验证，不能从 Editor 成功推断。Unity 生成的包锁文件及应用项目设置应保留。

## 3. CLI 场景配置与 Web 构建

在仓库根目录依次运行，不同时启动多个 Unity 命令：

```powershell
.\scripts\Open-UnityStudio.ps1 -ExecuteMethod Studio.Editor.StudioBuild.Configure -LogPath .\Logs\configure.log
.\scripts\Open-UnityStudio.ps1 -BuildTarget WebGL -ExecuteMethod Studio.Editor.StudioBuild.BuildWeb -LogPath .\Logs\web-build.log
```

[UnityStudio/Assets/Studio/Editor/StudioBuild.cs](UnityStudio/Assets/Studio/Editor/StudioBuild.cs) 创建应用自己的管线资源和场景副本，调用 UMA 资源库重建接口，并启用 Web embedded resources。首次验证暂使用完整资源库，构建体积与内存尚未优化，不代表发布预算。

已经完成 UMA 导入和基础配置后，只更新中文界面接线可运行下面的入口，不必重新扫描完整资源库：

```powershell
.\scripts\Open-UnityStudio.ps1 -ExecuteMethod Studio.Editor.StudioBuild.ConfigureWorkbench -LogPath .\Logs\workbench-configure.log
```

该入口校验参数中文标签与字体字形，创建 UI Toolkit 资产，停用旧界面及其输入系统，并选择中文 Web 模板。之后仍需运行 `Studio.Editor.StudioBuild.BuildWeb` 更新浏览器构建。

Web 输出放在 `UnityStudio/Builds/Web`，使用开发构建和禁用压缩的配置以便定位问题。只有构建成功且实际输出存在后才启动本地 HTTP 服务，不能直接双击 HTML 运行 WebAssembly 应用。

配置步骤已经通过；构建与浏览器验证的完成状态见本文开头。

Web 构建必须保留 `UI/Default` 和 `UI/Default Font`；构建入口会检查并维护这些动态使用的 Shader，避免默认 UI 显示紫色且缺少 `_Stencil`。按用户要求不使用截图验证，改用 Shader 编译记录、浏览器控制台、加载完成状态与 WebGL 上下文状态；这些检查不替代人工画质或完整交互验收。

通过标准：浏览器中确实出现有材质的人物；至少一次外观参数修改或重新生成有效；无粉色错误材质、未处理异常或空白画布。Editor Play Mode 成功不能代替 Web 成功。

## 摆姿的后续方向

当前先不实现自定义 FK/IK。人物生成后首先核对 UMA 生成的 Humanoid Avatar，优先评估 Unity 动画片段预设、Animator/Playable 时间采样与定格，再评估 HumanPose 的肌肉参数编辑。非 Humanoid 的人物需要另行处理，不能默认可用。

这些属于待验证方向，不代表已选定求值顺序或具备运行时摆姿功能；Animation Rigging 不作为当前人物创建的阻塞依赖。

## 来源

- [Unity 6.6 系统要求](https://docs.unity3d.com/6000.6/Documentation/Manual/system-requirements.html)
- [UMA V3.1f1](https://github.com/umasteeringgroup/UMA/releases/tag/V3.1f1)，源码提交 `c99e594755455cd1e2fa0e02c4af8fa43b97e292`
- [UMA WebGL 配置源码](https://github.com/umasteeringgroup/UMA/blob/V3.1f1/UMAProject/Assets/UMA/Core/Editor/Scripts/UMAWebGLSetup.cs)
- [Noto CJK 官方字体仓库](https://github.com/notofonts/noto-cjk)，使用 Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf。
- [原产品设计](DESIGN.md) 与 [原实施规划](IMPLEMENTATION_PLAN.md)，其阶段约束已由当前 Web 优先验证目标覆盖。