import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '../core/pipeline.js';
import { parseStream, replay } from '../demo/replay.js';
import { Session, type ServerInMessage, type ServerOutMessage } from './session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 向上查找含 package.json 的项目根，兼容 tsx 源码运行与 dist 编译运行两种深度。 */
function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'samples'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const ROOT = findProjectRoot(__dirname);
const SAMPLES_DIR = join(ROOT, 'samples');
const WEB_DIST = join(ROOT, 'dist', 'web');

export async function buildServer() {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(fastifyWebsocket);

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  app.get('/api/samples', async () => {
    const session = new Session(() => {}, SAMPLES_DIR);
    return { samples: await session.listSamples() };
  });

  /** 服务端无头处理样本：证明解析逻辑可在无浏览器环境运行，返回完整结果用于下载。 */
  app.get<{ Params: { id: string }; Querystring: { delayMs?: string } }>(
    '/api/samples/:id/process',
    async (req, reply) => {
      const session = new Session(() => {}, SAMPLES_DIR);
      const { meta, stream } = await session.getSample(req.params.id);
      const pipeline = new Pipeline(meta.initialCols, meta.initialRows);
      const frames = parseStream(stream);
      const delayMs = Math.min(5000, Math.max(0, Number(req.query.delayMs ?? 0) || 0));
      const events: unknown[] = [];
      await replay(frames, {
        delayMs,
        onData: async (payload, index) => {
          const r = await pipeline.push(payload);
          events.push({
            frame: index,
            seq: r.result.snapshot.seq,
            mode: r.result.extraction.mode,
            rowCount: r.result.extraction.rows.length,
            notes: r.tokens.length,
          });
        },
        onResize: async (cols, rows) => {
          await pipeline.resize(cols, rows);
        },
      });
      const result = pipeline.current();
      reply.header('content-type', 'application/json; charset=utf-8');
      return {
        sample: meta,
        screen: {
          cols: result.snapshot.cols,
          rows: result.snapshot.rows,
          bufferType: result.snapshot.bufferType,
          lines: result.snapshot.lines,
        },
        extraction: result.extraction,
        records: result.records,
        notes: result.notes,
        frameEvents: events,
      };
    },
  );

  app.get('/ws', { websocket: true }, (socket) => {
    const session = new Session(
      (msg: ServerOutMessage) => socket.send(JSON.stringify(msg)),
      SAMPLES_DIR,
    );
    socket.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as ServerInMessage;
        await session.handle(msg);
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', message: (err as Error).message } satisfies ServerOutMessage));
      }
    });
    socket.on('close', () => session.close());
  });

  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`TermData 服务已启动: http://127.0.0.1:${port}`);
  if (!existsSync(SAMPLES_DIR)) {
    app.log.warn('samples 目录不存在，请先运行 npm run gen:samples');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
