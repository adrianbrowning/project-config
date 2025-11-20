import fs from "fs";

import path from "path";

import JSON5 from "json5";

// Helper function to read and parse JSON5 or JSON
function readJsonFile(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON5.parse(data);
}

// Parse command-line arguments
const args = process.argv.slice(2);
const tsConfigPaths = [];
let outDir = '.';

for (let index = 0; index < args.length; index++){
  const arg = args[index];
  if (arg === '-o') {
    outDir = args[index + 1];
    index = index + 1;
  } else if (arg.startsWith('-')) {
    console.error(`Unknown option: ${arg}`);
    console.error('Usage: node create-base-config.js -o output_directory tsconfig1.json5 [tsconfig2.json5 ...]');
    process.exit(1);
  } else {
    tsConfigPaths.push(arg);
  }
}

if (tsConfigPaths.length === 0) {
  console.error('Error: At least one tsconfig file must be provided.');
  console.error('Usage: node create-base-config.js -o output_directory tsconfig1.json5 [tsconfig2.json5 ...]');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  console.error(`Error: Output directory does not exist: ${outDir}`);
  process.exit(1);
}

// Read and parse all tsconfig files
const compilerOptionsList = tsConfigPaths.map(filePath => {
  const tsConfig = readJsonFile(filePath);
  return tsConfig.compilerOptions || {};
});

// Find common compilerOptions
const commonCompilerOptions = compilerOptionsList.reduce((commonOptions, currentOptions) => {
  const newCommonOptions = {};
  for (const [key, value] of Object.entries(commonOptions)) {
    if (currentOptions[key] === value) {
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
