import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { load } from "js-yaml";
import type { Plugin } from "vite";

const SKIP_DIRS = new Set(["node_modules", "target", "dist", "__pycache__", "snap"]);
const MAX_DEPTH = 8;
const MAX_DIRS = 300_000;
const TIME_BUDGET_MS = 8000;
const MAX_BODY = 1024 * 1024;
const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".pgm": "image/x-portable-graymap" };

/** 探索の起点。環境変数 MAPS_DIR があればそれ、無ければホームディレクトリ */
const searchRoot = () => path.resolve(process.env.MAPS_DIR ?? os.homedir());

/** root 以下から、指定した名前のファイルを探す(隠しフォルダとシンボリックリンクは辿らない) */
function* findByName(root: string, name: string): Generator<string> {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const queue: [string, number][] = [[root, 0]];
  let visited = 0;
  while (queue.length && visited++ < MAX_DIRS && Date.now() < deadline) {
    const [dir, depth] = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (depth < MAX_DEPTH && !ent.name.startsWith(".") && !SKIP_DIRS.has(ent.name)) {
          queue.push([path.join(dir, ent.name), depth + 1]);
        }
      } else if (ent.isFile() && ent.name === name) {
        yield path.join(dir, ent.name);
      }
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * POST /api/resolve-map  body: { name, yaml }
 * ブラウザは選んだファイルの場所を教えられないため、YAML の名前と中身を受け取り、
 * PC 内から「同名かつ同内容」のファイルを探して、その YAML が指す画像を返す。
 * 返すのは一致した YAML が参照する画像(png/pgm)だけで、任意パスの読み出しはできない。
 */
export function mapsPlugin(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/api/resolve-map") return next();
    const fail = (code: number, msg: string) => {
      res.statusCode = code;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(msg);
    };
    if (req.method !== "POST") return fail(405, "POST only");

    let name: string;
    let yaml: string;
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.name !== "string" || typeof body.yaml !== "string") throw new Error();
      ({ name, yaml } = body);
    } catch {
      return fail(400, "bad request");
    }
    if (name !== path.basename(name)) return fail(400, "bad name");

    const root = searchRoot();
    for (const candidate of findByName(root, name)) {
      let text: string;
      try {
        text = fs.readFileSync(candidate, "utf8");
      } catch {
        continue;
      }
      if (text.trim() !== yaml.trim()) continue;
      const image = (load(text) as { image?: unknown } | null)?.image;
      if (typeof image !== "string") continue;
      const imgPath = path.isAbsolute(image) ? image : path.resolve(path.dirname(candidate), image);
      const mime = IMAGE_MIME[path.extname(imgPath).toLowerCase()];
      if (!mime || !fs.existsSync(imgPath)) continue;
      res.setHeader("content-type", mime);
      res.setHeader("x-map-path", encodeURIComponent(candidate));
      return void fs.createReadStream(imgPath).pipe(res);
    }
    fail(404, `${root} の中に、同じ内容の ${name}(と画像)が見つかりません`);
  };
  return {
    name: "maps-api",
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}
