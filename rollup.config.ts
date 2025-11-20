/**
 * @packageDocumentation
 * Rollup Config.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import { type RollupOptions } from "rollup";
import nativeDelete from './rollup-plugins/rollup-plugin-native-delete.ts';
import {z} from "zod";
import esbuild from "rollup-plugin-esbuild";

//
const __dirnameESM = path.dirname(new URL(import.meta.url).pathname);

const projectRootDir = path.resolve(__dirnameESM);


const pkgJSON = z.object({
  peerDependencies: z.object({
    "eslint": z.string(),
    "@commitlint/cli": z.string(),
    "husky": z.string(),
    "knip": z.string(),
    "lint-staged": z.string(),
    "@gingacodemonkey/semantic-release-unsquash": z.string(),
    "typescript": z.string(),
  })
}).parse(JSON.parse(fs.readFileSync(path.join(projectRootDir, "package.json"), { encoding: "utf-8" })));


export default {
  input: path.join(`src`, "setup.js"),
  preserveEntrySignatures: "exports-only",//"false",
  ////@ts-expect-error using the false value
  // preserveEntrySignatures: "false",//"exports-only",//"false",
  output: {
    dir: "dist/setup.js",
    format: "esm",
    // chunkFileNames: path.join("chunks", "[name]-[hash].js"),
    compact: true,

  },
  plugins: [
    nativeDelete({ targets: [ `dist${path.sep}*` ], runOnce: true }),
    replace({
      "__eslint_version__": pkgJSON.peerDependencies.eslint,
      "__commitlint_version__": pkgJSON.peerDependencies["@commitlint/cli"],
      "__husky_version__": pkgJSON.peerDependencies.husky,
      "__knip_version__": pkgJSON.peerDependencies.knip,
      "__lintstaged_version__": pkgJSON.peerDependencies["lint-staged"],
      "__semanticrelease_version__": pkgJSON.peerDependencies["@gingacodemonkey/semantic-release-unsquash"],
      "__ts_version__": "",
      preventAssignment: true,
    }),
    resolve({preferBuiltins: true}),
    typescript(),
    esbuild({
      platform: 'node', // Targets node environment
    }),
    commonjs(),
  ],
} satisfies RollupOptions;
