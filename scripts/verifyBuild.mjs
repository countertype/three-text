#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

function exists(file) {
  return fs.existsSync(file);
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function printBytes(bytes) {
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes > 1_000) return `${(bytes / 1_000).toFixed(2)} KB`;
  return `${bytes} B`;
}

function verifyOutputs() {
  const outputs = [
    'index.js',
    'index.min.js',
    'index.cjs',
    'index.min.cjs',
    'index.umd.js',
    'index.umd.min.js',
    'index.d.ts'
  ];
  outputs.forEach(rel => {
    const file = path.join(DIST, rel);
    check(exists(file), `Missing dist artifact: ${rel}`);
  });

  // License banner checks - verify that all main output files have proper headers
  const filesWithLicenseBanner = [
    'index.js',
    'index.min.js',
    'index.cjs',
    'index.min.cjs',
    'index.umd.js',
    'index.umd.min.js'
  ];
  
  filesWithLicenseBanner.forEach(rel => {
    const file = path.join(DIST, rel);
    const content = fs.readFileSync(file, 'utf8');
    
    // Verify the file starts with a comment block containing the banner
    check(
      content.trimStart().startsWith('/*!'),
      `License banner missing in dist/${rel} (should start with /*! comment)`
    );
  });

  // Print sizes
  const filesToReport = ['index.min.js', 'index.umd.min.js', 'index.min.cjs'];
  console.log('Artifacts:');
  filesToReport.forEach(rel => {
    const file = path.join(DIST, rel);
    console.log(`  ${rel.padEnd(18)} ${printBytes(sizeOf(file))}`);
  });
}

async function main() {
  const script = 'build';
  const start = Date.now();
  try {
    execSync(`npm run -s ${script}`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`Build failed running ${script}`);
    process.exit(1);
  }
  const durationMs = Date.now() - start;

  verifyOutputs();

  console.log(`\nBuild succeeded in ${(durationMs / 1000).toFixed(2)}s (${script})`);
}

main();

