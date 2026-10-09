目标：
在 `/Users/redcreen/Project/imgEditor` 独立维护“通用矢量图编辑器”，供任意本机项目调用；用户通过拖节点修改曲线，保存后由助手读取精确数据。

已完成：
源码、启动入口、测试、心形示例及 Skill 模板已从 daban 迁入本项目；个人 `$vector-editor` Skill 已安装，自带完整编辑器。支持贝塞尔画线、节点/控制柄拖动、尖角/平滑/对称、双击与右键加点、闭合、撤销重做、底图及版本保存。节点类型和新节点默认类型均可保存。跨项目保存隔离、自动端口和同项目服务复用已验证。

2026-10-09 新增镜像和测量：两次点击画任意方向对称轴，选曲线生成独立镜像副本，保留原作及节点类型/控制柄，支持撤销重做；对称轴作为可选 `mirrorAxis` 字段随 v1 JSON 保存。测量支持两点/连续多点直线距离、右键整条曲线弧长、点击首段并 Shift 点击末段的连续选段；闭合路径可切换另一侧。所有数值为原图 px，测量状态不保存、不导出。源码验证后同步全局 Skill。

进行中：
镜像与测量功能已实现；等待用户试用反馈或新需求。迁移前的聊天历史仍在原项目，当前交接不代表聊天记录迁移。

涉及文件：
- `tools/curve-editor/`：`app.js`、`geometry.js`、`interactions.js`、`index.html`、`style.css`、`server.py`。
- `tools/curve-editor/README.md`：操作与维护说明；`examples/`：可编辑心形 JSON/SVG。
- `tools/curve-editor/skill/`：Skill 模板；`install_skill.py`：同步共用版。
- `tests/curve-editor/`：22项几何/交互测试、3项HTTP保存与跨项目验证；另有 `browser_test.cjs`，用独立临时项目验证镜像、撤销重做、保存恢复、点距吸附、弧长、连续选段、缩放不改距离、测量快捷键不改作品和导出隔离。浏览器测试需要 Playwright，可通过 `NODE_PATH` 指向依赖目录，设置 `CURVE_EDITOR_BROWSER_CHANNEL=chrome` 使用已安装的 Chrome。
- 根目录 `打开通用矢量图编辑器.command`：启动；`AGENTS.md`：本项目工作约定。
- 已安装 Skill：`/Users/redcreen/.codex/skills/vector-editor/`。
- 原用户曲线存档：`/Users/redcreen/Project/daban/work/curve_editor/sessions/`；本项目后续保存使用自己的同名相对目录。

约束：
仅本机使用，文件留在各自项目，保留用户画布和保存历史。PNG/JPG/WebP作为底图，JSON可直接编辑，SVG只导出，AI/CDR/PDF暂不能直接导入；坐标是像素，未标定毫米。数据标识 `daban-curve-editor` v1 保留兼容。原8767页面属于 daban，不能当作本项目页面使用。以后修改本项目源码，验证后通过安装脚本更新全局 Skill；原项目副本保留兼容。

下一步：
1. 阅读本项目 `AGENTS.md` 和工具 `README.md`，确认当前状态。
2. 用户要求启动时，针对本项目打开编辑器；需要旧作品时通过“打开修改”导入原存档JSON。
3. 等用户给出试用反馈或新功能要求，再修改、验证并同步共用 Skill。旧页面使用新版前应先保存，再刷新，不能替用户刷新未保存的画布。

先恢复记忆，等我给你指令在执行
