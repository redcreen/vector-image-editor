# 通用矢量图编辑器

## 项目定位

本目录是“通用矢量图编辑器”的独立源码维护项目，2026-10-09 从 `/Users/redcreen/Project/daban` 迁入。今后修改本目录的源码；原项目副本作为兼容与回退保留。不要把原打版项目的生产业务规则带入此通用工具。

## 结构与调用

- `tools/curve-editor/`：无前端依赖的 HTML/CSS/JavaScript/SVG 编辑器与 Python 本机保存服务。
- `tests/curve-editor/`：节点几何、交互及跨项目保存隔离测试。
- `tools/curve-editor/skill/`：个人 Skill 模板，入口名 `vector-editor`。
- `python3 tools/curve-editor/install_skill.py`：更新 `$CODEX_HOME/skills/vector-editor`，未设置时更新 `~/.codex/skills/vector-editor`。安装包自带工具和示例，不依赖本源码目录。
- 双击根目录 `打开通用矢量图编辑器.command`：优先启动全局 Skill，未安装时回退到本项目源码。

修改代码后先验证相应行为，再同步共用 Skill。避免只修改已安装副本导致源码与工具分叉。

## 不变量

- 启动显式使用目标项目的 `--project`，保存到该项目 `work/curve_editor/sessions/`；自动端口只复用身份与保存目录一致的服务。不要盲用另一个项目已经打开的8767页面。
- 数据格式保留 `daban-curve-editor` v1 兼容标识。JSON 保留节点及控制柄、各节点类型和新节点默认类型，保存每次另建版本。
- 坐标为图像像素，未标定毫米。PNG/JPG/WebP仅作为底图；JSON可编辑；SVG仅导出；AI/CDR/PDF尚不支持直接导入。
- 保留用户未保存的画布。导入新作品或刷新前先保存，测试尽量用独立临时项目。
- 只监听本机回环地址，不创建云站点、外部上传或开机启动项。

## 验证

```sh
node --test tests/curve-editor/*.test.cjs
python3 tests/curve-editor/server_test.py
```

迁移状态和接续提示见 `HANDOFF.md`。用户新的指令优先，避免把交接中的候选工作当成已授权任务。
