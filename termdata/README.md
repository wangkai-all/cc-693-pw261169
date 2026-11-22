# TermData · 终端数据接入工具

把一个持续输出「设备状态表」的终端进程的**原始字节流**接入系统：先完整还原终端屏幕，
再从屏幕格子中抽取结构化数据。演示端只写字节，不提供任何结构化接口。

## 设计约束与对应实现

| 约束 | 实现 |
| --- | --- |
| 输入只有原始终端字节流，无结构化接口 | `src/core` 只接受 `Uint8Array`；演示端 `src/demo` 仅通过 ANSI 字节输出 |
| 回车、退格、光标移动、清行、替代屏幕刷新同一区域 | `@xterm/headless` 无头终端还原屏幕，按帧 diff，而不是把每次输出当新增行 |
| UTF-8 字符可能拆在两次读取中 | `StreamSplitter` 缓存跨 push 的不完整 UTF-8 尾字节与不完整转义序列 |
| 中文宽字符占不同列 | 一切定位以 xterm 的格子（cell）列号为准，宽字符 width=2、尾格 width=0 |
| 帮助页暂停表格提取，回来后重新确认表头 | `TableExtractor` 维护 suspended 状态，返回后必须再次识别到表头才恢复 |
| 只支持明确列出的 ANSI 操作 | `src/core/catalog.ts` 白名单；未列出的序列生成 `UnsupportedNote` 标注影响 |
| 不支持的序列不能直接删掉 | 所有字节（含不支持序列）仍原样送入模拟器，只额外标注 |
| 数据行定位到屏幕格子和形成它的输出片段 | 每个格子带 `CellMeta`（字节区间+读取批次），数据行汇总 `fragments` |
| 可改变终端宽度、触发覆盖更新、换屏 | 操作页指令 W/O/R，经 WebSocket 下发给演示引擎 |
| 可重放字节样例与结果下载 | `samples/*.tstream` 分帧字节；前端可下载 JSON/CSV/屏幕文本，服务端可离线处理 |

## 目录结构

```
src/
  core/        与运行环境无关的核心管道（可同时跑在 Node 与浏览器）
    splitter.ts    字节流分词（C0/C1/ESC/CSI/OSC/DCS/APC，UTF-8 拆包缓存）
    catalog.ts     明确支持的 ANSI 操作白名单
    classifier.ts  白名单判定 + 不支持序列的原因/影响描述
    emulator.ts    xterm headless 封装 + 格子级溯源 diff
    extractor.ts   屏幕模式判定、表头确认、表格抽取、帮助页暂停
    pipeline.ts    串联以上模块的处理管道
  demo/        演示进程（只输出字节流）与样本重放工具
  server/      Fastify：HTTP API + WebSocket，转发演示字节流
  web/         Vue 3 前端：真实终端画面 + 解析数据 + 溯源面板
scripts/gen-samples.ts  生成 8 个可重放样本
tests/        38 个 vitest 用例
samples/      .tstream（4 字节大端长度分帧）+ .json 元数据
```

## 快速开始

```bash
npm install
npm run gen:samples     # 生成 samples/ 下的 8 个字节样本
npm test                # 运行 38 个测试
npm run build           # 类型检查并编译核心、构建前端
npm start               # 启动服务，打开 http://127.0.0.1:8787
```

开发模式（两个进程，Vite 代理 /api 与 /ws 到 8787）：

```bash
npm run dev:server      # Fastify（tsx watch）
npm run dev:web         # Vite dev server（5173）
```

单独观察演示进程的原始字节（可选）：

```bash
npm run demo | xxd | less
```

## 操作页指令

| 按钮 | 含义 |
| --- | --- |
| H 帮助 | 进入帮助页，表格提取暂停；返回后需重新确认表头 |
| W 宽度 | 终端宽度 80 → 100 → 60 → 80 循环，整屏回流 |
| O 覆盖 | 在同一区域反白覆盖一条告警，不产生滚动新行 |
| R 换屏 | 退出并重新进入替代屏幕（DEC 1049） |
| X 不支持序列 | 输出鼠标上报、小键盘、OSC52、裸 C1、未知 SGR，观察影响标注 |

## 8 个可重放样本

`01` 基础表格刷新 · `02` 帮助页暂停 · `03` 宽度变化 · `04` 覆盖更新 ·
`05` 换屏 · `06` 不支持序列 · `07` UTF-8 半字符拆包 · `08` 综合混合场景

## HTTP / WebSocket

- `GET /api/samples` 样本列表
- `GET /api/samples/:id/process` 服务端无头处理样本，返回屏幕、抽取结果、记录与全部标注（可直接下载）
- `WS /ws` 消息：上行 `start-live / start-replay / stop / command`；
  下行 `chunk(base64 原始字节) / resize / mode / done / error`

## 支持的 ANSI 操作（摘要）

- C0：BS、HT、LF、VT、FF、CR
- ESC：IND、RI、NEL、DECSC/DECRC、US-ASCII 字符集
- CSI：光标移动 A-G/d/H/f、ED、EL、ICH/DCH/ECH、IL/DL、DECSTBM、SU/SD、白名单 SGR
- 私有模式：DEC 1049/47（替代屏幕）、DEC 25（光标可见性）
- OSC：0、2（标题）

白名单之外的一切序列都会在「不支持序列」面板中标注**原因与可能影响**，原始字节不删除。
