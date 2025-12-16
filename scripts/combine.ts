import fs from "fs";

import path from "path";

import JSON5 from "json5";


// Helper function to read and parse JSON5 or JSON
function readJsonFile(filePath: string) {
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON5.parse(data);
}

// Parse command-line arguments
const args = process.argv.slice(2);
let basePath = "";
const tsConfigPaths: Array<string> = [];
let outDir = '.';

for (let index = 0; index < args.length; index++){
  const arg = args[index];
  if (arg === '-o') {
    outDir = args[index + 1]!;
    index = index + 1;
  } else if (arg?.startsWith('-')) {
    console.error(`Unknown option: ${arg}`);
    console.error('Usage: node create-base-config.js -o output_directory tsconfig1.json');
    process.exit(1);
  } else if(arg) {
      basePath = arg;
  }
}

if (basePath.length === 0) {
  console.error('Error: At least one tsconfig file must be provided.');
  console.error('Usage: node create-base-config.js -o output_directory tsconfig1.json');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  console.error(`Error: Output directory does not exist: ${outDir}`);
  process.exit(1);
}

function getTsConfigPaths(tsConfigPath: string, relativeTo = "") {
    const baseTsConfig = readJsonFile(path.relative(relativeTo, tsConfigPath));
    if (baseTsConfig.extends) {
        if (Array.isArray(baseTsConfig.extends)) {
            tsConfigPaths.push(...baseTsConfig.extends.map((p: string) => path.join(path.dirname(tsConfigPath), p)));
        } else {
            tsConfigPaths.push(path.join(path.dirname(tsConfigPath), baseTsConfig.extends));
        }
    }
    return baseTsConfig;
}

let baseCompilerOptions = getTsConfigPaths(basePath).compilerOptions || {};
for (const tsConfigPath of tsConfigPaths) {
    const tsConfig = getTsConfigPaths(tsConfigPath);
    baseCompilerOptions = { ...baseCompilerOptions, ...tsConfig.compilerOptions };

}


console.log(JSON.stringify({compilerOptions: sortObject(baseCompilerOptions)}, null, 2));
process.exit(0);

function sortObject(obj: any) {
    return Object.keys(obj)
        .sort()
        .reduce((result: any, key) => {
            result[key] = obj[key];
            return result;
        }, {});
}
const compilerOptionsList = tsConfigPaths.filter(Boolean)
    .map(filePath => {
        const tsConfig = readJsonFile(filePath!);
        return tsConfig.compilerOptions || {};
    });

// // Read and parse all tsconfig files
// const compilerOptionsList = tsConfigPaths.filter(Boolean)
//     .map(filePath => {
//   const tsConfig = readJsonFile(filePath!);
//   return tsConfig.compilerOptions || {};
// });

// Find common compilerOptions
const commonCompilerOptions = compilerOptionsList.reduce((commonOptions, currentOptions) => {
  const newCommonOptions = {};
  for (const [key, value] of Object.entries(commonOptions)) {
    if (currentOptions[key] === value) {
        //@ts-expect-error
      newCommonOptions[key] = value;
    }
  }
  return newCommonOptions;
}, compilerOptionsList[0] || {});

// Write base tsconfig.json
const baseConfig = { compilerOptions: commonCompilerOptions };
const baseConfigPath = path.join(outDir, 'base.tsconfig.json');
fs.writeFileSync(baseConfigPath, JSON.stringify(baseConfig, null, 2), 'utf8');

console.log(`Base config created: ${baseConfigPath}`);
