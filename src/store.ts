import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { opportunity } from "./model.ts";
import type { Repository } from "./importer.ts";

const catalogFile = z.strictObject({
  version: z.literal(1),
  opportunities: z.array(opportunity).refine(
    (rows) => new Set(rows.map(({ id }) => id)).size === rows.length, "Duplicate stored IDs",
  ),
});

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}

export function jsonRepository(path: string): Repository {
  return {
    async read() {
      try {
        return catalogFile.parse(await readJson(path)).opportunities;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async write(rows) {
      const data = catalogFile.parse({ version: 1, opportunities: rows });
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
