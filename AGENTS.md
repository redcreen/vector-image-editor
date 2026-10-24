# 通用矢量图编辑器

## 项目定位

本目录是“通用矢量图编辑器”的独立源码维护项目，2026-10-09 从 `/Users/redcreen/Project/daban` 迁入。今后修改本目录的源码；原项目副本作为兼容与回退保留。不要把原打版项目的生产业务规则带入此通用工具。

## 结构与调用

- `tools/curve-editor/`：无前端依赖的 HTML/CSS/JavaScript/SVG 编辑器与 Python 本机保存服务。
- `tests/curve-editor/`：节点几何、交互及跨项目保存隔离测试。
- `tools/curve-editor/skill/`：个人 Skill 模板，入口名 `vector-editor`。
- `python3 tools/curve-editor/install_skill.py`：更新 `$CODEX_HOME/skills/vector-editor`，未设置时更新 `~/.codex/skills/vector-editor`。安装包自带工具和示例，不依赖本源码目录。
- 双击根目录 `打开通用矢量图编辑器.command`：优先启动全局 Skill，未安装时回退到本项目源码。

修改代码后先验证相应行为；验证通过后自动发布到共用 Skill（运行安装脚本），无需再次询问。发布后核对源码与已安装文件一致；状态栏源码变更时同步重建已安装应用。避免只修改已安装副本导致源码与工具分叉。

发布后如需重启后台服务，由 Codex 直接完成，不把重启留给用户。保持原端口、项目、工作区和保存目录，验证原地址提供新版，让用户刷新原页面即可使用。编辑器每步操作已有本机自动记录；先只读确认“已保存在本机 · 刷新可恢复”，不额外点击“保存给 AI”或“另存为”，也不擅自刷新用户页面。自动记录异常时先查明并保护现有画布。

## 不变量

- 尺寸优先：后续功能凡能保留、读取或导入实际尺寸信息，都必须按实际尺寸计算与处理，包括复制粘贴、跨画布操作、导入导出及变换。跨画布按双方标定比例换算，保持物理大小，不用屏幕缩放或裸像素替代已有尺寸；尺寸或单位缺失时先标定或明确选择单位，不猜测实际比例。

- 选色交互：所有新增或修改的颜色选择入口，都须像拟合调色一样提供可直接点击的常用颜色，并保留自定义颜色；不要只提供系统调色器。曲线改色支持多选、撤销/重做和本机恢复。

- 画布默认在系统浏览器中通过本机 HTTP 端口打开：启动使用 `--open`，访问本次输出的完整 `http://127.0.0.1:<端口>` 地址。用户指定其他浏览器时遵照其选择。状态栏仅管理列表，画布仍为浏览器网页。
- 启动显式使用目标项目的 `--project`，默认按 Codex 会话 ID 隔离到该项目 `work/curve_editor/sessions/isolated/<ID的SHA-256>/`；显式 `--shared 名称` 使用 `sessions/shared/<名称的SHA-256>/`，`--shared default` 访问原有根目录存档。以本次输出或 health.saves 确认保存目录；自动端口只复用项目、工作区、版本与保存目录一致的服务。打开完整 URL，保留共享地址的 client 参数。不要盲用另一个会话或项目已经打开的8767页面。
- 数据格式保留 `daban-curve-editor` v1 兼容标识。JSON 保留节点及控制柄、各节点类型和新节点默认类型，保存每次另建版本。
- 节点与控制柄坐标仍用兼容的 `image-px` 模型。两点标定的 mm/cm 比例记录在 `calibration`；AI 按点、DXF 按文件单位换算成毫米坐标并自动设置 1 mm/坐标单位。DXF 未指定单位时必须让用户选择，旧 JSON 未标定不得猜测实际长度。支持 AI/DXF 线稿导入为可编辑节点；按全部可见内容或所选图层导出 AI/DXF/SVG，必须有有效比例并写入实际尺寸。导出界面每次打开默认 AI；各格式显示原曲线节点数 → 实际导出曲线节点数，文件控制点/控制柄另列。DXF 预计算两种实际文件，默认选曲线节点更少的方式（不把控制柄计为节点，相同选“保留曲线”）；保留曲线用三次 SPLINE 保留贝塞尔几何、控制柄和闭合状态，纯直线路径仍为折线，外部软件须支持样条；可选原有“折线兼容”，曲线近似误差上限 0.01 mm。DXF 导出窗口分别显示曲线节点、文件样条控制点及折线顶点；AI/SVG 分开显示曲线节点与文件坐标点（含控制柄/闭合重复点），切换方式同步更新，切换范围重新比较；AI 输出兼容型 Illustrator 线稿。复杂外观/文字/图片等不支持内容应明确报错，不静默丢弃。SVG 仅导出，CDR/PDF 文件入口不直接导入。PNG/JPG/WebP 仍为图片图层。
- 保留用户未保存的画布。导入新作品或刷新前先保存，测试尽量用独立临时项目。
- 只监听本机回环地址，不创建云站点、外部上传或开机启动项。

## 验证

```sh
node --test tests/curve-editor/*.test.cjs
python3 tests/curve-editor/server_test.py
python3 tests/curve-editor/workspace_server_test.py
python3 tests/curve-editor/vector_ai_test.py
python3 tests/curve-editor/vector_dxf_test.py
python3 tests/curve-editor/vector_io_test.py
python3 tests/curve-editor/vector_http_test.py
```

迁移状态和接续提示见 `HANDOFF.md`。用户新的指令优先，避免把交接中的候选工作当成已授权任务。
