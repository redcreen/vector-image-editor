# 可编辑曲线格式

扩展名 `.json`，格式标识保留 `daban-curve-editor` 以兼容既有文件；它不限制文件所属项目。节点的 `in`、`out` 为绝对坐标，不能当成相对向量。

```json
{
  "format": "daban-curve-editor",
  "version": 1,
  "title": "曲线示例",
  "width": 1000,
  "height": 700,
  "units": "image-px",
  "newNodeMode": "smooth",
  "image": null,
  "opacity": 0.65,
  "paths": [{
    "id": "curve-1",
    "name": "轮廓",
    "role": "outline",
    "color": "#e04544",
    "dashed": true,
    "closed": false,
    "note": "",
    "nodes": [
      {"x": 200, "y": 350, "in": {"x": 120, "y": 350}, "out": {"x": 280, "y": 350}, "mode": "smooth"},
      {"x": 800, "y": 350, "in": {"x": 650, "y": 200}, "out": {"x": 950, "y": 500}, "mode": "symmetric"}
    ]
  }]
}
```

- 相邻点 A、B 的三次贝塞尔段是 `A → A.out → B.in → B`。闭合路径（至少3点）还要绘制末点至首点这一段。
- `cusp` 尖角：两控制柄独立；`smooth` 平滑：两柄与节点共线、反向，长度独立；`symmetric` 对称：反向且等长。生成节点时坐标应符合其类型，不能只改标签。
- `newNodeMode` 是新节点沿用类型；每个节点的 `mode` 是其自身类型。读取时区分两者。
- `role` 支持 `outline`、`seam`、`cut`、`note`，只是用途标记，不代表已验证生产参数。
- 可选 `dashed` 必须为布尔值；`true` 表示显示为虚线，`false` 或省略表示实线。它只控制呈现，节点、控制柄和长度计算仍使用同一条连续贝塞尔几何；保存预览 SVG 使用 `stroke-dasharray="8 6"`。
- 可选 `originals` 使用与 `paths` 相同结构，保留修改前参考线；省略时，导入器会将导入的 `paths` 作为初始参考。
- 可选 `mirrorAxis: {"a":{"x":500,"y":100},"b":{"x":500,"y":600}}` 为两个不同像素坐标确定的无限对称轴。省略或 `null` 表示未设置。镜像副本是 `paths` 中具有独立 id 的普通曲线，节点及绝对控制柄均经同一反射变换；原曲线保留。对称轴不属于作品线条，不导出 SVG。
- 可选 `calibration: {"a":{"x":100,"y":100},"b":{"x":200,"y":100},"length":10,"unit":"cm"}` 记录两点的已知实际距离。省略或 `null` 表示未标定；单位仅支持 `mm`/`cm`，长度必须为正数，两点不能重合。换算比例 `mm/px = length × (unit 为 cm 时 10，否则 1) ÷ 两点像素直线距离`，曲线实际弧长为像素弧长乘此比例。可选 `measureUnit` 为测量显示单位 `mm`/`cm`，默认 `mm`；显示 cm 时再将 mm 除以 10。标定不改变节点、控制柄、画板坐标或 `units: "image-px"`，适用于整幅图的统一比例。SVG 仍为像素尺寸，说明中记录比例，参考线不导出。
- 测量是临时界面状态，不写入 JSON。多点距离为相邻点欧氏距离之和；曲线长度应沿三次贝塞尔积分或自适应细分求弧长，不能用节点间直线距离代替。连续段以节点索引定义，第 i 段连接节点 i 和 i+1，闭合末段连接末点和首点。
- 可选底图：`image: {"name":"底图.png","dataUrl":"data:image/png;base64,...","width":1000,"height":700}`，支持 PNG/JPEG/WebP，画板尺寸应与底图一致。
- 坐标以左上为原点、X向右、Y向下。画板外节点也会保存，预览时避免无意裁掉它们。

生成 JSON 后通过编辑器“打开修改”导入，检查曲线和节点。生成源稿保存在当前项目，用户后续保存由程序产生新版本，不覆盖源稿。直接检查最新保存时，不要重新生成近似曲线。

## 可选图层扩展（仍为 v1）

`layers` 和 `images` 必须同时提供。`layers` 按从后到前排序，1–200 层；`images` 最多 200 张。每条曲线及每张图片必须且只能归属一个图层，引用必须存在。

```json
{
  "layers": [
    {"id":"layer-1","name":"参考图片","visible":true,"locked":false,"pathIds":[],"imageIds":["image-1"]},
    {"id":"layer-2","name":"轮廓","visible":true,"locked":false,"pathIds":["curve-1"],"imageIds":[]}
  ],
  "images": [
    {"id":"image-1","name":"参考.png","dataUrl":"data:image/png;base64,...","x":100,"y":80,"width":600,"height":400,"opacity":1}
  ]
}
```

图片的 `x/y` 为画板左上坐标，`width/height` 为显示像素尺寸，可与原始图片尺寸不同；`opacity` 为 0–1。缩放曲线直接更新节点与绝对控制柄坐标，不增加曲线坐标变换字段。图片坐标绝对值和正尺寸均最多 1e7；图层/图片 id 必须非空且唯一，最多 200 字符。隐藏图层保留在 JSON 中，但不进入保存预览及 SVG 导出；锁定图层仍显示。同层图片先绘制、曲线后绘制。

没有扩展字段的旧文件会将曲线归入默认图层；旧 `image` 转为原点处、画板尺寸的锁定图片层，继承 `opacity`。新版保存用 `image: null` 和 `images` 表示图片。保存配套 SVG 包含可见图片，“导出 SVG”按钮仍只导出可见曲线。标定保持画板像素比例，移动或缩放元素不改动 `calibration`；不能据此推断每张导入图片的真实尺度相同。


## 可选操作记录扩展（仍为 v1）

“另存为”生成的 JSON 保留普通作品顶层字段，并附带可选 `operationHistory`；“保存给 AI”省略此字段，仅输出当前作品。副本使用紧凑 JSON，保存与打开上限均为 256MB；项目保存服务仍限制 32MB，AI 保存不携带历史。AI 读取副本时如只需当前形状，可忽略该扩展。

`operationHistory` 使用 `{format: "curve-editor-session", version: 1, assets: [...], data: {current: {...}, history: {...}}}`。`assets` 是去重后的图片 data URL；历史快照中的 `dataUrl` 使用 `{asset: N}` 引用。`current` 只含当前编辑状态（`selected`、`ni`、`selection`、`imageSelection`、`activeLayer`、`nodeSelection`、`drawing`、`tool`），其作品来自文件顶层，不另存一份当前作品。

`history` 为 `{version: 1, past: [...], future: [...], pastLabels: [...], futureLabels: [...]}`。每个快照包含普通作品 `doc` 和编辑状态，不能再嵌套操作记录。`past` 按时间从旧到新，`future` 按重做栈从远到近存储；各自与标签数量一致，合计最多 100 步，单个标签最多 200 字符。打开前验证所有快照；损坏记录导致打开失败，保留现有画布和记录。旧 JSON 无此字段时仍按普通作品打开，无法补回未保存的历史。
