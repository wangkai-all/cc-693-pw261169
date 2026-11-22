import { DemoEngine } from './engine.js';

/**
 * 演示进程 CLI：把字节流直接写到 stdout（真实 PTY 场景），
 * 同时支持从 stdin 读取单键命令。
 */
async function main() {
  const engine = new DemoEngine(Number(process.env.DEMO_INTERVAL ?? 900));
  const write = (b: Uint8Array) => {
    // process.stdout.write 只接受 Buffer/string，转换时保持字节不变。
    process.stdout.write(Buffer.from(b));
  };
  engine.on('data', write);

  const shutdown = () => {
    engine.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  };

  engine.start();

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on('data', (key: Buffer) => {
      const k = key.toString('utf8');
      if (k === 'h' || k === 'H') engine.command('help');
      else if (k === 'q' || k === 'Q') engine.command('quit-help');
      else if (k === 'w' || k === 'W') engine.command('resize');
      else if (k === 'o' || k === 'O') engine.command('overlay');
      else if (k === 'r' || k === 'R') engine.command('swap');
      else if (k === 'x' || k === 'X') engine.command('unsupported');
      else if (key[0] === 0x03) {
        shutdown();
      }
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 无人按键时自动演示一轮覆盖更新。
  setTimeout(() => engine.command('overlay'), 5000);
  // 保持事件循环。
  await new Promise<void>(() => {});
}

main().catch((err) => {
  process.stderr.write(String(err));
  process.exit(1);
});
