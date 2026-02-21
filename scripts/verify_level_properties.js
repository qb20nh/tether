#!/usr/bin/env node
import { LEVELS } from '../tether_levels.js';
import { HINT_CODES } from '../tether_config.js';
import { parseLevel, keyOf, keyV } from '../tether_utils.js';
import {
  evaluateBlockedCells,
  evaluateHints,
  evaluateRPS,
  evaluateStitches,
} from '../tether_rules.js';

const CONSTRAINT_CODES = new Set(['t', 'r', 'l', 's', 'h', 'v', 'g', 'b', 'p']);
const ORTH_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const ALL_DIRS = [
  ...ORTH_DIRS,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const DEFAULTS = {
  minRaw: 1,
  minCanonical: 2,
  minHintOrders: 0,
  minCornerOrders: 0,
  maxSolutions: 20000,
  timeMs: 30000,
};

const usage = () => {
  console.log(
    [
      'Usage:',
      '  node scripts/verify_level_properties.js [options]',
      '',
      'Options:',
      '  --level <selector>            Level index, nameKey, or name. Repeatable.',
      '  --min-raw <n>                 Minimum raw solutions (default: 1).',
      '  --min-canonical <n>           Minimum canonical solutions (default: 2).',
      '  --min-hint-orders <n>         Minimum distinct hint-visit orders (default: 0).',
      '  --min-corner-orders <n>       Minimum distinct corner-satisfaction orders (default: 0).',
      '  --max-solutions <n>           Early stop after this many raw solutions (default: 20000).',
      '  --time-ms <n>                 Per-level timeout in ms (default: 30000).',
      '  --json                        Output JSON summary.',
      '  --help                        Show this help.',
      '',
      'Examples:',
      '  node scripts/verify_level_properties.js --level level.tutorial_6.name',
      '  node scripts/verify_level_properties.js --level 18 --min-canonical 2 --min-hint-orders 2',
      '  node scripts/verify_level_properties.js --min-canonical 1 --json',
    ].join('\n'),
  );
};

const toInt = (name, value) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got: ${value}`);
  }
  return n;
};

function parseArgs(argv) {
  const opts = {
    levels: [],
    minRaw: DEFAULTS.minRaw,
    minCanonical: DEFAULTS.minCanonical,
    minHintOrders: DEFAULTS.minHintOrders,
    minCornerOrders: DEFAULTS.minCornerOrders,
    maxSolutions: DEFAULTS.maxSolutions,
    timeMs: DEFAULTS.timeMs,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[i];
    };

    if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--level') {
      opts.levels.push(next());
    } else if (a === '--min-raw') {
      opts.minRaw = toInt('--min-raw', next());
    } else if (a === '--min-canonical') {
      opts.minCanonical = toInt('--min-canonical', next());
    } else if (a === '--min-hint-orders') {
      opts.minHintOrders = toInt('--min-hint-orders', next());
    } else if (a === '--min-corner-orders') {
      opts.minCornerOrders = toInt('--min-corner-orders', next());
    } else if (a === '--max-solutions') {
      opts.maxSolutions = toInt('--max-solutions', next());
    } else if (a === '--time-ms') {
      opts.timeMs = toInt('--time-ms', next());
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return opts;
}

function resolveLevelSelector(selector) {
  if (/^\d+$/.test(selector)) {
    const idx = Number.parseInt(selector, 10);
    if (idx < 0 || idx >= LEVELS.length) {
      throw new Error(`Level index out of range: ${selector}`);
    }
    return { index: idx, level: LEVELS[idx] };
  }

  const byKey = LEVELS.findIndex((lv) => lv.nameKey === selector);
  if (byKey >= 0) return { index: byKey, level: LEVELS[byKey] };

  const byName = LEVELS.findIndex((lv) => lv.name === selector);
  if (byName >= 0) return { index: byName, level: LEVELS[byName] };

  throw new Error(`Could not resolve level selector: ${selector}`);
}

const pathKey = (path) => path.map((p) => `${p.r},${p.c}`).join('|');
const canonicalPathKey = (path) => {
  const f = pathKey(path);
  const b = [...path].reverse().map((p) => `${p.r},${p.c}`).join('|');
  return f < b ? f : b;
};

const hintOrderSignature = (path, gridData) => {
  const parts = [];
  for (const p of path) {
    const ch = gridData[p.r][p.c];
    if (CONSTRAINT_CODES.has(ch)) parts.push(`${ch}@${p.r},${p.c}`);
  }
  return parts.join('>');
};

const edgeKey = (a, b) => {
  const ka = `${a.r},${a.c}`;
  const kb = `${b.r},${b.c}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const cornerCountFromEdges = (vr, vc, edgeSet) => {
  let count = 0;
  if (edgeSet.has(`${vr - 1},${vc - 1}|${vr - 1},${vc}`)) count++;
  if (edgeSet.has(`${vr - 1},${vc - 1}|${vr},${vc - 1}`)) count++;
  if (edgeSet.has(`${vr - 1},${vc}|${vr},${vc}`)) count++;
  if (edgeSet.has(`${vr},${vc - 1}|${vr},${vc}`)) count++;
  return count;
};

const cornerOrderSignature = (path, cornerCounts) => {
  if (!cornerCounts || cornerCounts.length === 0) return '';

  const edgeSet = new Set();
  const satisfied = new Set();
  const order = [];

  // Corners with target 0 are satisfied at step 0.
  for (const [vr, vc, target] of cornerCounts) {
    const key = `${vr},${vc}`;
    if (target === 0) {
      satisfied.add(key);
      order.push(key);
    }
  }

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    if (Math.abs(prev.r - cur.r) + Math.abs(prev.c - cur.c) === 1) {
      edgeSet.add(edgeKey(prev, cur));
    }

    for (const [vr, vc, target] of cornerCounts) {
      const key = `${vr},${vc}`;
      if (satisfied.has(key)) continue;
      if (cornerCountFromEdges(vr, vc, edgeSet) === target) {
        satisfied.add(key);
        order.push(key);
      }
    }
  }

  return order.join('>');
};

const buildStitchReq = (stitches) => {
  const req = new Map();
  for (const [vr, vc] of stitches) {
    req.set(keyV(vr, vc), {
      nw: { r: vr - 1, c: vc - 1 },
      ne: { r: vr - 1, c: vc },
      sw: { r: vr, c: vc - 1 },
      se: { r: vr, c: vc },
    });
  }
  return req;
};

const chooseCount = (n, k) => {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    result = (result * (n - kk + i)) / i;
  }
  return Math.round(result);
};

function solveLevel(level, opts) {
  const parsed = parseLevel(level);
  const baseGrid = parsed.g.map((row) => row.slice());
  const rows = parsed.rows;
  const cols = parsed.cols;
  const stitchSet = new Set(parsed.stitches.map(([vr, vc]) => keyV(vr, vc)));
  const stitchReq = buildStitchReq(parsed.stitches);
  const cornerCounts = parsed.cornerCounts || [];
  const movableWalls = [];
  const movableCandidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = baseGrid[r][c];
      if (ch === 'm') movableWalls.push({ r, c });
      if (ch === '.' || ch === 'm') movableCandidates.push({ r, c });
    }
  }
  const movableWallsPresent = movableWalls.length > 0;
  const placementsTotal = chooseCount(movableCandidates.length, movableWalls.length);

  const deadline = Date.now() + opts.timeMs;
  let timedOut = false;
  const rawSet = new Set();
  const canonicalSet = new Set();
  const hintOrderSet = new Set();
  const cornerOrderSet = new Set();
  let earlySatisfied = false;
  let placementsChecked = 0;
  const requirementsMet = () =>
    rawSet.size >= opts.minRaw &&
    canonicalSet.size >= opts.minCanonical &&
    hintOrderSet.size >= opts.minHintOrders &&
    cornerOrderSet.size >= opts.minCornerOrders;

  const runForPlacement = (wallCells) => {
    const gridData = baseGrid.map((row) => row.slice());
    for (const cell of movableCandidates) gridData[cell.r][cell.c] = '.';
    for (const cell of wallCells) gridData[cell.r][cell.c] = 'm';

    const usableCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = gridData[r][c];
        if (ch === '#' || ch === 'm') continue;
        usableCells.push({ r, c });
      }
    }

    const neighborMap = new Map();
    for (const cell of usableCells) {
      const out = [];
      for (const [dr, dc] of ALL_DIRS) {
        const nr = cell.r + dr;
        const nc = cell.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const target = gridData[nr][nc];
        if (target === '#' || target === 'm') continue;
        const next = { r: nr, c: nc };

        const adr = Math.abs(cell.r - next.r);
        const adc = Math.abs(cell.c - next.c);
        if (adr + adc === 1) {
          out.push(next);
        } else if (adr === 1 && adc === 1) {
          const vr = Math.max(cell.r, next.r);
          const vc = Math.max(cell.c, next.c);
          if (stitchSet.has(keyV(vr, vc))) out.push(next);
        }
      }
      neighborMap.set(keyOf(cell.r, cell.c), out);
    }

    const validPrefix = (path, visited) => {
      const snapshot = {
        rows,
        cols,
        totalUsable: parsed.usable,
        gridData,
        path,
        visited,
        stitches: parsed.stitches,
        stitchSet,
        stitchReq,
        cornerCounts,
      };

      if (evaluateHints(snapshot).bad > 0) return false;
      if (evaluateStitches(snapshot).bad > 0) return false;
      if (evaluateRPS(snapshot).bad > 0) return false;
      if (evaluateBlockedCells(snapshot).bad > 0) return false;
      return true;
    };

    const dfs = (path, visited) => {
      if (rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }
      if (!validPrefix(path, visited)) return;

      if (path.length === parsed.usable) {
        rawSet.add(pathKey(path));
        const canonical = canonicalPathKey(path);
        if (!canonicalSet.has(canonical)) {
          canonicalSet.add(canonical);
          hintOrderSet.add(hintOrderSignature(path, gridData));
          cornerOrderSet.add(cornerOrderSignature(path, cornerCounts));
        }
        if (requirementsMet()) earlySatisfied = true;
        return;
      }

      const last = path[path.length - 1];
      const nbs = neighborMap.get(keyOf(last.r, last.c)) || [];
      for (const nb of nbs) {
        const nk = keyOf(nb.r, nb.c);
        if (visited.has(nk)) continue;
        visited.add(nk);
        path.push(nb);
        dfs(path, visited);
        path.pop();
        visited.delete(nk);
        if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      }
    };

    for (const start of usableCells) {
      if (earlySatisfied) break;
      if (HINT_CODES.has(gridData[start.r][start.c])) continue;
      const visited = new Set([keyOf(start.r, start.c)]);
      dfs([{ r: start.r, c: start.c }], visited);
      if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) break;
    }
  };

  if (movableWalls.length === 0) {
    placementsChecked = 1;
    runForPlacement([]);
  } else {
    const selected = [];
    const choosePlacement = (startIndex, picksLeft) => {
      if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }
      if (picksLeft === 0) {
        placementsChecked += 1;
        runForPlacement(selected);
        return;
      }
      for (let i = startIndex; i <= movableCandidates.length - picksLeft; i++) {
        selected.push(movableCandidates[i]);
        choosePlacement(i + 1, picksLeft - 1);
        selected.pop();
        if (timedOut || rawSet.size >= opts.maxSolutions || earlySatisfied) return;
      }
    };
    choosePlacement(0, movableWalls.length);
  }

  return {
    rawSolutions: rawSet.size,
    canonicalSolutions: canonicalSet.size,
    distinctHintOrders: hintOrderSet.size,
    distinctCornerOrders: cornerOrderSet.size,
    timedOut,
    hitMaxSolutions: rawSet.size >= opts.maxSolutions,
    earlySatisfied,
    movableWallsPresent,
    movableWallsCount: movableWalls.length,
    wallPlacementsChecked: placementsChecked,
    wallPlacementsTotal: placementsTotal,
  };
}

function verifyResult(result, opts) {
  const failures = [];
  if (result.timedOut && !result.earlySatisfied) failures.push('timeout');
  if (result.rawSolutions < opts.minRaw) {
    failures.push(`rawSolutions ${result.rawSolutions} < ${opts.minRaw}`);
  }
  if (result.canonicalSolutions < opts.minCanonical) {
    failures.push(`canonicalSolutions ${result.canonicalSolutions} < ${opts.minCanonical}`);
  }
  if (result.distinctHintOrders < opts.minHintOrders) {
    failures.push(`distinctHintOrders ${result.distinctHintOrders} < ${opts.minHintOrders}`);
  }
  if (result.distinctCornerOrders < opts.minCornerOrders) {
    failures.push(`distinctCornerOrders ${result.distinctCornerOrders} < ${opts.minCornerOrders}`);
  }
  return failures;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    usage();
    process.exit(2);
  }

  let selected = [];
  try {
    if (opts.levels.length === 0) {
      selected = LEVELS.map((lv, index) => ({ index, level: lv }));
    } else {
      selected = opts.levels.map(resolveLevelSelector);
    }
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(2);
  }

  const results = [];
  for (const { index, level } of selected) {
    const metrics = solveLevel(level, opts);
    const failures = verifyResult(metrics, opts);
    results.push({
      index,
      nameKey: level.nameKey || null,
      name: level.name || null,
      ...metrics,
      pass: failures.length === 0,
      failures,
    });
  }

  const summary = {
    checked: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    defaults: {
      minRaw: opts.minRaw,
      minCanonical: opts.minCanonical,
      minHintOrders: opts.minHintOrders,
      minCornerOrders: opts.minCornerOrders,
      maxSolutions: opts.maxSolutions,
      timeMs: opts.timeMs,
    },
  };

  if (opts.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    for (const r of results) {
      const label = r.nameKey || r.name || `level[${r.index}]`;
      const status = r.pass ? 'PASS' : 'FAIL';
      const note = r.failures.length ? ` :: ${r.failures.join('; ')}` : '';
      const movableNote = r.movableWallsPresent
        ? ` movableWalls=${r.movableWallsCount} placements=${r.wallPlacementsChecked}/${r.wallPlacementsTotal}`
        : '';
      console.log(
        `[${status}] idx=${r.index} ${label} raw=${r.rawSolutions} canonical=${r.canonicalSolutions}` +
        ` hintOrders=${r.distinctHintOrders} cornerOrders=${r.distinctCornerOrders}` +
        `${movableNote}${note}`,
      );
    }
    console.log(
      `Summary: checked=${summary.checked} passed=${summary.passed} failed=${summary.failed}`,
    );
  }

  process.exit(summary.failed === 0 ? 0 : 1);
}

main();
