import type { Terminal } from '@xterm/headless';
// @xterm/headless 6.0 未声明 package.json "exports"：
// - Node 原生 ESM / tsx 下命名导入会在链接阶段失败，只能拿到 CJS default；
// - Vite 走 "module" 字段，default 同样指向模块整体。
// 统一用 default 导入再取 Terminal，两种环境都可工作。
import headless from '@xterm/headless';

type TerminalCtor = typeof Terminal;
interface CjsModule {
  Terminal?: TerminalCtor;
  default?: CjsModule;
}

function resolveTerminal(mod: unknown): TerminalCtor {
  const m = mod as CjsModule | TerminalCtor;
  if (typeof m === 'function') return m as TerminalCtor;
  if (m.Terminal) return m.Terminal;
  if (m.default) return resolveTerminal(m.default);
  throw new Error('无法从 @xterm/headless 解析 Terminal 构造器');
}

export const HeadlessTerminal: TerminalCtor = resolveTerminal(headless);
