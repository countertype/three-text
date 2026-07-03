/**
 * A/B performance benchmark with Welch's t-test.
 *
 * Usage:
 *   npx tsx bench/perf-ab.ts                    # single run (baseline capture)
 *   npx tsx bench/perf-ab.ts --baseline out.json # compare against saved baseline
 *   npx tsx bench/perf-ab.ts --save out.json     # save results to file
 *   npx tsx bench/perf-ab.ts --runs 30           # number of measured iterations
 *   npx tsx bench/perf-ab.ts --warmup 10         # warmup iterations
 *
 * Reports: mean, median, stdev, 95% CI, and Welch's t-test p-value when comparing.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { Text } from '../src/core/Text';
import { Text as VectorText } from '../src/vector/core/index';
import enUs from '../src/hyphenation/en-us';
import {
  globalGlyphCache,
  globalContourCache,
  globalWordCache,
  globalClusteringCache
} from '../src/core/cache/sharedCaches';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let ss = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - m;
    ss += d * d;
  }
  return ss / (xs.length - 1);
}

function stdev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

// Welch's t-test (unequal variances)
// Returns { t, df, p } where p is two-tailed p-value
function welchTTest(a: number[], b: number[]): { t: number; df: number; p: number } {
  const nA = a.length;
  const nB = b.length;
  const mA = mean(a);
  const mB = mean(b);
  const vA = variance(a);
  const vB = variance(b);

  const sA = vA / nA;
  const sB = vB / nB;
  const se = Math.sqrt(sA + sB);

  if (se < 1e-15) return { t: 0, df: nA + nB - 2, p: 1 };

  const t = (mA - mB) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = (sA + sB) * (sA + sB);
  const den = (sA * sA) / (nA - 1) + (sB * sB) / (nB - 1);
  const df = den > 0 ? num / den : nA + nB - 2;

  // Two-tailed p-value via regularized incomplete beta function
  const p = tDistCDF(Math.abs(t), df);
  return { t, df, p: 2 * (1 - p) };
}

// Student's t CDF via regularized incomplete beta function
// Using continued fraction approximation (Lentz's method)
function tDistCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const ibeta = regularizedBeta(x, a, b);
  return 1 - 0.5 * ibeta;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry relation when x > (a+1)/(a+b+2)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }

  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const prefix = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;

  // Lentz's continued fraction
  const maxIter = 200;
  const eps = 1e-14;
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= maxIter; m++) {
    // Even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= c * d;

    // Odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return prefix * f;
}

// Lanczos approximation for log-gamma
function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }

  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ---------------------------------------------------------------------------
// Benchmark scenarios
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  name: string;
  times: number[];
  mean: number;
  median: number;
  stdev: number;
  ci95Low: number;
  ci95High: number;
  p5: number;
  p95: number;
  n: number;
}

// Text and parameters taken directly from examples/index.html demo defaults
const DEMO_TEXT = `three-text is a 3D font geometry and text layout library for the web. It supports TTF, OTF, WOFF, and WOFF2 font files. For layout, it uses Tex-based parameters for breaking text into paragraphs across multiple lines and supports CJK and RTL scripts. three-text caches the geometries it generates for low CPU overhead in languages with lots of repeating glyphs. Variable fonts are supported as static instances at a given axis coordinate, and can be animated by re-drawing each frame with new coordinates. The library has a framework-agnostic core that returns raw vertex data, with lightweight adapters for Three.js, React Three Fiber, p5.js, WebGL and WebGPU. Under the hood, three-text relies on HarfBuzz for text shaping, Knuth-Plass line breaking, Liang hyphenation, libtess by Eric Veach for tessellation, curve polygonization from Maxim Shemanarev's Anti-Grain Geometry, and Visvalingam-Whyatt line simplification`;

const SHORT_TEXT = 'Hello, World!';

const OVERLAP_WORD = 'W'.repeat(60);
const OVERLAP_TEXT = Array.from({ length: 20 }, () => OVERLAP_WORD).join(' ');

// Repeated text to stress cache-hit path
const REPEATED_TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

// Demo layout config from examples/index.html
const DEMO_LAYOUT = {
  width: 1400,
  align: 'justify' as const,
  direction: 'ltr' as const,
  hyphenate: true,
  language: 'en-us',
  tolerance: 200,
  pretolerance: 100,
  emergencyStretch: 0,
  respectExistingBreaks: true,
  lefthyphenmin: 2,
  righthyphenmin: 4,
  linepenalty: 10,
  adjdemerits: 10000,
  hyphenpenalty: 50,
  exhyphenpenalty: 50,
  doublehyphendemerits: 10000
};

async function initHarfBuzz(): Promise<ArrayBuffer> {
  const hbWasmPath = require.resolve('../node_modules/harfbuzzjs/hb.wasm');
  const hbNodeBuffer = fs.readFileSync(hbWasmPath);
  const hbArrayBuffer = hbNodeBuffer.buffer.slice(
    hbNodeBuffer.byteOffset,
    hbNodeBuffer.byteOffset + hbNodeBuffer.byteLength
  );
  Text.setHarfBuzzBuffer(hbArrayBuffer);
  await Text.init();
  Text.registerPattern('en-us', enUs);

  const fontPath = require.resolve('../examples/fonts/NimbusSanL-Reg.woff');
  const fontNodeBuffer = fs.readFileSync(fontPath);
  return fontNodeBuffer.buffer.slice(
    fontNodeBuffer.byteOffset,
    fontNodeBuffer.byteOffset + fontNodeBuffer.byteLength
  );
}

type Scenario = {
  name: string;
  fn: () => Promise<void>;
  setup?: () => void; // called before each measured iteration (outside timing)
};

function buildScenarios(fontBuffer: ArrayBuffer): Scenario[] {
  // Matches examples/index.html defaults exactly
  const demoConfig = {
    font: fontBuffer,
    size: 72,
    depth: 7,
    lineHeight: 1.33,
    letterSpacing: 0,
    color: [1, 1, 1] as [number, number, number],
    curveFidelity: {
      distanceTolerance: 0.5,
      angleTolerance: 0.25
    },
    geometryOptimization: {
      enabled: false,
      areaThreshold: 1.0
    },
    layout: DEMO_LAYOUT
  };

  return [
    {
      // The primary scenario: exactly what happens when the demo loads
      name: 'create:demo-paragraph',
      fn: async () => {
        await Text.create({ ...demoConfig, text: DEMO_TEXT });
      }
    },
    {
      // What happens on every UI tweak in the demo (update path, caches hot)
      name: 'update:demo-paragraph',
      fn: (() => {
        let handle: Awaited<ReturnType<typeof Text.create>> | null = null;
        return async () => {
          if (!handle) {
            handle = await Text.create({ ...demoConfig, text: DEMO_TEXT });
          }
          handle = await handle.update({ text: DEMO_TEXT + '.' });
          handle = await handle.update({ text: DEMO_TEXT });
        };
      })()
    },
    {
      name: 'create:short',
      fn: async () => {
        await Text.create({
          ...demoConfig,
          text: SHORT_TEXT,
          layout: { ...DEMO_LAYOUT, width: undefined, hyphenate: false }
        });
      }
    },
    {
      // Repeated text to stress the cache-hit path
      name: 'create:repeated (cache stress)',
      fn: async () => {
        await Text.create({ ...demoConfig, text: REPEATED_TEXT });
      }
    },
    {
      name: 'create:overlap',
      fn: async () => {
        await Text.create({
          ...demoConfig,
          text: OVERLAP_TEXT,
          letterSpacing: -0.15,
          removeOverlaps: true,
          layout: {
            ...DEMO_LAYOUT,
            width: 20000,
            align: 'left' as const,
            hyphenate: false
          }
        });
      }
    },
    {
      name: 'create:demo+color',
      fn: async () => {
        await Text.create({
          ...demoConfig,
          text: DEMO_TEXT,
          color: {
            default: [1, 1, 1] as [number, number, number],
            byText: {
              'three-text': [1, 0, 0] as [number, number, number],
              'HarfBuzz': [0, 1, 0] as [number, number, number]
            }
          }
        });
      }
    },
    {
      name: 'create:demo-flat (depth=0)',
      fn: async () => {
        await Text.create({ ...demoConfig, text: DEMO_TEXT, depth: 0 });
      }
    },
    // ── Vector (slug) pipeline: collectForSlug + packSlugData ──
    {
      name: 'vector:demo-paragraph',
      fn: async () => {
        await VectorText.create({ ...demoConfig, text: DEMO_TEXT });
      }
    },
    {
      name: 'vector:repeated (cache stress)',
      fn: async () => {
        await VectorText.create({ ...demoConfig, text: REPEATED_TEXT });
      }
    },
    // ── Cold-cache scenarios (caches cleared before each run) ──
    {
      name: 'cold:demo-paragraph',
      setup: () => {
        globalGlyphCache.clear();
        globalContourCache.clear();
        globalWordCache.clear();
        globalClusteringCache.clear();
      },
      fn: async () => {
        await Text.create({ ...demoConfig, text: DEMO_TEXT });
      }
    },
    {
      name: 'cold:demo-flat (depth=0)',
      setup: () => {
        globalGlyphCache.clear();
        globalContourCache.clear();
        globalWordCache.clear();
        globalClusteringCache.clear();
      },
      fn: async () => {
        await Text.create({ ...demoConfig, text: DEMO_TEXT, depth: 0 });
      }
    }
  ];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const BATCH_SIZE = 5;

async function runScenario(
  scenario: Scenario,
  warmup: number,
  runs: number
): Promise<BenchmarkResult> {
  const canGC = typeof globalThis.gc === 'function';

  // Warmup (includes batched iterations to let V8 fully optimize)
  for (let i = 0; i < warmup * BATCH_SIZE; i++) {
    await scenario.fn();
  }
  if (canGC) globalThis.gc();

  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    // GC before every measurement to prevent GC pauses landing inside timed region
    if (canGC) globalThis.gc();

    // Batch multiple iterations per measurement to amortize OS scheduling noise
    // (skip batching for scenarios with setup hooks -- each iteration needs fresh state)
    const batchN = scenario.setup ? 1 : BATCH_SIZE;
    if (scenario.setup) scenario.setup();
    const t0 = performance.now();
    for (let b = 0; b < batchN; b++) {
      await scenario.fn();
    }
    const t1 = performance.now();
    times.push((t1 - t0) / batchN);
  }

  const m = mean(times);
  const s = stdev(times);
  const med = median(times);
  const n = times.length;

  // 95% CI: mean ± t_{0.025, n-1} * (s / sqrt(n))
  // Use 1.96 for large n, or approximate t critical value
  const tCrit = n >= 30 ? 1.96 : tCriticalApprox(n - 1);
  const ci = tCrit * (s / Math.sqrt(n));

  return {
    name: scenario.name,
    times,
    mean: m,
    median: med,
    stdev: s,
    ci95Low: m - ci,
    ci95High: m + ci,
    p5: percentile(times, 0.05),
    p95: percentile(times, 0.95),
    n
  };
}

// Rough t critical value for 95% CI with small df
function tCriticalApprox(df: number): number {
  // Table for common values, fallback to normal approx
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    15: 2.131, 20: 2.086, 25: 2.060, 29: 2.045
  };
  if (table[df]) return table[df];
  if (df > 29) return 1.96;
  // Linear interpolate between known values
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    if (df >= keys[i] && df <= keys[i + 1]) {
      const frac = (df - keys[i]) / (keys[i + 1] - keys[i]);
      return table[keys[i]] * (1 - frac) + table[keys[i + 1]] * frac;
    }
  }
  return 1.96;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function formatResult(r: BenchmarkResult): string {
  const cv = r.mean > 0 ? ((r.stdev / r.mean) * 100).toFixed(1) : '0.0';
  return [
    `  ${r.name}`,
    `    mean: ${r.mean.toFixed(3)}ms  median: ${r.median.toFixed(3)}ms`,
    `    stdev: ${r.stdev.toFixed(3)}ms  CV: ${cv}%`,
    `    95% CI: [${r.ci95Low.toFixed(3)}, ${r.ci95High.toFixed(3)}]ms`,
    `    p5: ${r.p5.toFixed(3)}ms  p95: ${r.p95.toFixed(3)}ms  n=${r.n}`
  ].join('\n');
}

function formatComparison(
  current: BenchmarkResult,
  baseline: BenchmarkResult
): string {
  const { t, df, p } = welchTTest(current.times, baseline.times);
  const delta = current.mean - baseline.mean;
  const pctChange = baseline.mean > 0 ? (delta / baseline.mean) * 100 : 0;
  const direction = delta < 0 ? 'FASTER' : delta > 0 ? 'SLOWER' : 'SAME';

  const sig = p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : 'ns';

  const sigLevel = sig === 'ns'
    ? 'not significant'
    : p < 0.001 ? 'significant at 0.1% level'
    : p < 0.01 ? 'significant at 1% level'
    : 'significant at 5% level';
  const deltaSign = delta >= 0 ? '+' : '';
  const pctSign = pctChange >= 0 ? '+' : '';

  return [
    '  ' + current.name,
    '    baseline: ' + baseline.mean.toFixed(3) + 'ms -> current: ' + current.mean.toFixed(3) + 'ms',
    '    delta: ' + deltaSign + delta.toFixed(3) + 'ms (' + pctSign + pctChange.toFixed(1) + '%) ' + direction,
    '    Welch t=' + t.toFixed(3) + ', df=' + df.toFixed(1) + ', p=' + p.toFixed(6) + ' ' + sig,
    '    (' + sigLevel + ')'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface SavedResults {
  timestamp: string;
  node: string;
  results: BenchmarkResult[];
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const runs = Number(getArg('--runs') ?? 30);
  const warmup = Number(getArg('--warmup') ?? 8);
  const savePath = getArg('--save');
  const baselinePath = getArg('--baseline');

  console.log(`\nPerformance benchmark: ${runs} runs, ${warmup} warmup`);
  console.log(`Node ${process.version} | ${process.platform} ${process.arch}`);
  console.log('─'.repeat(60));

  const fontBuffer = await initHarfBuzz();
  const scenarios = buildScenarios(fontBuffer);
  const results: BenchmarkResult[] = [];

  for (const scenario of scenarios) {
    process.stdout.write(`  Running: ${scenario.name}...`);
    const result = await runScenario(scenario, warmup, runs);
    results.push(result);
    process.stdout.write(` ${result.mean.toFixed(3)}ms\n`);
  }

  // Load baseline if provided
  let baseline: SavedResults | null = null;
  if (baselinePath && fs.existsSync(baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  }

  // Print results
  console.log('\n' + '═'.repeat(60));
  if (baseline) {
    console.log('A/B COMPARISON (baseline → current)');
    console.log('Significance: *** p<0.001  ** p<0.01  * p<0.05  ns not significant');
    console.log('─'.repeat(60));

    for (const result of results) {
      const base = baseline.results.find((r) => r.name === result.name);
      if (base) {
        console.log(formatComparison(result, base));
      } else {
        console.log(formatResult(result));
        console.log('    (no baseline for comparison)');
      }
      console.log();
    }
  } else {
    console.log('RESULTS');
    console.log('─'.repeat(60));
    for (const result of results) {
      console.log(formatResult(result));
      console.log();
    }
  }

  // Save results if requested
  if (savePath) {
    const saved: SavedResults = {
      timestamp: new Date().toISOString(),
      node: process.version,
      results
    };
    fs.writeFileSync(savePath, JSON.stringify(saved, null, 2));
    console.log(`Results saved to ${savePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
