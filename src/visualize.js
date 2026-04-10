import { loadConfigSync } from './config.js';

function topologicalSort(steps) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();
  const stepMap = new Map(steps.map(s => [s.name, s]));

  function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular dependency: ${name}`);
    visiting.add(name);
    const step = stepMap.get(name);
    if (step) {
      for (const dep of step.dependencies) visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }

  for (const step of steps) visit(step.name);
  return sorted;
}

function buildGraphData(steps) {
  const nodes = new Map();
  const edges = [];
  for (const step of steps) {
    nodes.set(step.name, {
      name: step.name,
      avgDuration: step.avgDuration,
      stdDeviation: step.stdDeviation,
      errorRatio: step.errorRatio,
      dependencies: step.dependencies
    });
    for (const dep of step.dependencies) {
      edges.push({ from: dep, to: step.name });
    }
  }
  return { nodes, edges };
}

function assignLevels(nodes, sortedNames) {
  const levels = new Map();
  const visited = new Set();

  function assignLevel(name, level) {
    if (visited.has(name)) {
      if (level > levels.get(name)) levels.set(name, level);
      return;
    }
    visited.add(name);
    levels.set(name, level);
  }

  for (const name of sortedNames) {
    if (!nodes.get(name).dependencies.length) assignLevel(name, 0);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const name of sortedNames) {
      const node = nodes.get(name);
      if (node.dependencies.length === 0) continue;
      const maxDepLevel = Math.max(...node.dependencies.map(d => levels.get(d) ?? -1));
      if (maxDepLevel >= 0) {
        const currentLevel = levels.get(name) ?? -1;
        if (maxDepLevel + 1 > currentLevel) {
          assignLevel(name, maxDepLevel + 1);
          changed = true;
        }
      }
    }
  }
  return levels;
}

function drawDAG(config) {
  const { nodes, edges } = buildGraphData(config.steps);
  const sortedNames = topologicalSort(config.steps);
  const levels = assignLevels(nodes, sortedNames);

  const maxLevel = Math.max(...levels.values(), 0);

  const levelMap = new Map();
  for (const [name, level] of levels) {
    if (!levelMap.has(level)) levelMap.set(level, []);
    levelMap.get(level).push(name);
  }

  const nodeWidth = 16;
  const nodeHeight = 4;
  const hGap = 6;
  const vGap = 2;
  const colWidth = nodeWidth + hGap;

  const positions = new Map();
  for (const [name, level] of levels) {
    const row = levelMap.get(level).indexOf(name);
    positions.set(name, { col: level, row });
  }

  const nodesPerLevel = Array.from({ length: maxLevel + 1 }, (_, i) => levelMap.get(i)?.length || 0);
  const maxNodesInLevel = Math.max(...nodesPerLevel, 1);
  const totalRows = maxNodesInLevel * (nodeHeight + vGap);
  const totalCols = (maxLevel + 1) * colWidth;

  const canvas = [];
  for (let r = 0; r < totalRows; r++) {
    canvas.push(new Array(totalCols).fill(' '));
  }

  function drawBox(name, col, row) {
    const node = nodes.get(name);
    const x = col * colWidth;
    const y = row * (nodeHeight + vGap);

    const top = y;
    const left = x;

    canvas[top].fill('─', left, left + nodeWidth + 1);
    canvas[top + nodeHeight].fill('─', left, left + nodeWidth + 1);

    for (let r = top; r <= top + nodeHeight; r++) {
      canvas[r][left] = '│';
      canvas[r][left + nodeWidth] = '│';
    }

    canvas[top][left] = '┌';
    canvas[top][left + nodeWidth] = '┐';
    canvas[top + nodeHeight][left] = '└';
    canvas[top + nodeHeight][left + nodeWidth] = '┘';

    const nameDisplay = name.length > nodeWidth - 2 ? name.slice(0, nodeWidth - 3) + '…' : name;
    const nameStart = left + 1;
    for (let i = 0; i < nameDisplay.length && nameStart + i < totalCols; i++) {
      canvas[top + 1][nameStart + i] = nameDisplay[i];
    }

    const stats = `${node.avgDuration}ms`;
    for (let i = 0; i < stats.length && left + 1 + i < totalCols; i++) {
      canvas[top + 2][left + 1 + i] = stats[i];
    }
  }

  for (const [name] of positions) {
    const pos = positions.get(name);
    drawBox(name, pos.col, pos.row);
  }

  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;

    const fromX = from.col * colWidth + nodeWidth;
    const fromY = from.row * (nodeHeight + vGap) + Math.floor(nodeHeight / 2);
    const toX = to.col * colWidth;
    const toY = to.row * (nodeHeight + vGap) + Math.floor(nodeHeight / 2);

    if (from.col < to.col) {
      for (let x = fromX; x < toX; x++) {
        if (x < totalCols && fromY < totalRows) {
          if (canvas[fromY][x] === ' ') canvas[fromY][x] = '─';
        }
      }
      if (toX < totalCols && fromY < totalRows) {
        canvas[fromY][toX] = '─';
      }
    }
  }

  let output = '╔' + '═'.repeat(60) + '╗\n';
  output += '║ Process: ' + config.name.padEnd(52) + '║\n';
  output += '╚' + '═'.repeat(60) + '╝\n\n';

  const levelHeader = 'Levels: ';
  const levelStrs = Array.from({ length: maxLevel + 1 }, (_, i) => `L${i}`).join('  →  ');
  output += levelHeader + levelStrs + '\n';
  output += '        ' + '─'.repeat(maxLevel * 6) + '\n\n';

  for (const row of canvas) {
    const line = row.join('').trimEnd();
    if (line.trim()) output += line + '\n';
  }

  output += '\n' + '─'.repeat(60) + '\n';
  output += 'DEPENDENCIES:\n';
  for (const step of config.steps) {
    if (step.dependencies.length > 0) {
      output += `  ${step.name.padEnd(18)} ← ${step.dependencies.join(', ')}\n`;
    } else {
      output += `  ${step.name.padEnd(18)} [ENTRY]\n`;
    }
  }

  output += '\n' + '─'.repeat(60) + '\n';
  output += `Steps: ${config.steps.length} | Dependencies: ${edges.length} | Max depth: ${maxLevel + 1}\n`;

  return output;
}

function drawGraph(config) {
  return drawDAG(config);
}

function drawSimpleGraph(config) {
  const { nodes, edges } = buildGraphData(config.steps);
  const sortedNames = topologicalSort(config.steps);
  const levels = assignLevels(nodes, sortedNames);

  const maxLevel = Math.max(...levels.values(), 0);
  const levelMap = new Map();
  for (const [name, level] of levels) {
    if (!levelMap.has(level)) levelMap.set(level, []);
    levelMap.get(level).push(name);
  }

  let output = `Process: ${config.name}\n`;
  output += '='.repeat(config.name.length + 12) + '\n\n';

  for (let level = 0; level <= maxLevel; level++) {
    const nodesAtLevel = levelMap.get(level) || [];
    output += `[Level ${level}]\n`;

    for (const name of nodesAtLevel) {
      const node = nodes.get(name);
      const deps = node.dependencies.length > 0 ? `<- ${node.dependencies.join(', ')}` : '[ENTRY]';
      output += `  ${name.padEnd(16)} ${deps}\n`;
      output += `  ${''.padEnd(16)} dur:${node.avgDuration}ms err:${(node.errorRatio * 100).toFixed(1)}%\n`;
    }
    output += '\n';
  }

  output += '-'.repeat(40) + '\n';
  output += `Steps: ${config.steps.length} | Deps: ${edges.length} | Depth: ${maxLevel + 1}`;

  return output;
}

function visualizeConfig(configPath, options = {}) {
  let config;
  if (typeof configPath === 'object') {
    config = configPath;
  } else {
    config = loadConfigSync(configPath);
  }

  if (options.simple) return drawSimpleGraph(config);
  return drawDAG(config);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Process Graph Visualizer

Usage:
  node src/visualize.js <config-file>      Draw DAG
  node src/visualize.js <config-file> -s   Simple text mode
  node src/visualize.js <config-file> --list  List steps only

Examples:
  node src/visualize.js config/order-processing.json
  node src/visualize.js config/order-processing.json -s
`);
    return;
  }

  const listMode = args.includes('--list');
  const simpleMode = args.includes('-s') || args.includes('--simple');
  const configPath = args.find(arg => !arg.startsWith('-'));

  if (!configPath) {
    console.error('Please provide a config file path');
    process.exit(1);
  }

  try {
    const config = loadConfigSync(configPath);

    if (listMode) {
      console.log(`Process: ${config.name}\nSteps:`);
      for (const step of config.steps) {
        const deps = step.dependencies.length > 0 ? `<- ${step.dependencies.join(', ')}` : '';
        console.log(`  ${step.name} ${deps}`);
      }
      return;
    }

    console.log(visualizeConfig(config, { simple: simpleMode }));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

export { drawGraph, drawSimpleGraph, drawDAG, visualizeConfig, topologicalSort, buildGraphData };

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
