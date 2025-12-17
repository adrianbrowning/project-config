import { glob } from "node:fs";
import { rm } from "node:fs/promises";
import type { Plugin } from "rollup";

export interface NativeDeleteOptions {
  targets: string | Array<string>;
  verbose?: boolean;
  runOnce?: boolean; // If true, only delete once during build (recommended)
}

export default function nativeDelete(options: NativeDeleteOptions): Plugin {
  const { targets, verbose = false, runOnce = true } = options;
  let deleted = false;

  return {
    name: "native-delete",
    async buildStart() {
      if (runOnce && deleted) return;
      const list = Array.isArray(targets) ? targets : [ targets ];

      for (const pattern of list) {
        const matches = await new Promise<Array<string>>((resolve, reject) =>
          glob(pattern, (err: NodeJS.ErrnoException | null, files: Array<string>) =>
            err ? reject(err) : resolve(files)
          )
        );

        for (const file of matches) {
          try {
            await rm(file, { recursive: true, force: true });
            if (verbose) this.warn(`Deleted: ${file}`);
          }
          catch (err) {
            this.warn(`Failed to delete ${file}: ${(err as Error).message}`);
          }
        }
      }

      deleted = true;
    },
  };
}
