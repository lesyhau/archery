// Writes contributes.languageModelTools in package.json from src/ops/tools.ts.
// Run with: npm run gen:tools
import { readFileSync, writeFileSync } from 'node:fs';
import { languageModelTools } from '../src/ai/toolManifest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.contributes.languageModelTools = languageModelTools();
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`Wrote ${pkg.contributes.languageModelTools.length} language model tools to package.json`);
