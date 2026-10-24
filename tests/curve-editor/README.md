# 编辑器测试

通用几何和服务检查按根目录 `AGENTS.md` 中的命令运行。浏览器测试还需要本机安装 Playwright 及对应浏览器；可通过 `CURVE_EDITOR_BROWSER_CHANNEL=chrome` 使用 Chrome。

真实裁片、照片和导入样本只保存在本机 `fixtures/` 目录，不提交到仓库。缺少样本时，仅依赖该样本的测试显示 `Local fixture not supplied` 并跳过；通用测试继续执行。将原样本放回原路径后，对应回归自动恢复运行。存在但损坏的样本、几何差异和断言失败仍会报错。

本机样本包括 `fitting-*.json`、`offset-head-outline.json`、`simplify-*.json`、`textured-object.png`、`vector-dxf/basic-mm.dxf` 和 `vector-plt/large-horn.plt`。另有明确标记为可选的本地 AI / DXF 外部文件测试。

拟合性能探针需设置 `FITTING_PERF_REPORT` 为本机报告路径，并提供其使用的 `fitting-1hao.json`。测试输出、截图、发布备份和本机作品分别留在已忽略的 `tmp/`、`output/`、`work/` 下，不随代码推送。
