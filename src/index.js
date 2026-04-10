import { JSONLogger } from './logger.js';
import { Process } from './process.js';
import { loadConfigSync, listConfigs, getConfigDir } from './config.js';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runSimulation(config, logger, options = {}) {
  const processInstance = new Process(config, logger);
  return await processInstance.execute();
}

async function runSingleSimulation(config, logger, options = {}) {
  const processInstance = new Process(config, logger);
  const result = await processInstance.execute();
  return result;
}

async function runMultipleSimulations(configPath, count = 1, options = {}) {
  const logger = new JSONLogger();
  let config;

  if (typeof configPath === 'object') {
    config = configPath;
  } else {
    config = loadConfigSync(configPath);
  }

  const results = [];

  for (let i = 0; i < count; i++) {
    console.error(`Running simulation ${i + 1}/${count}...`);
    const result = await runSingleSimulation(config, logger, options);
    results.push(result);
  }

  const successes = results.filter(r => r.success).length;
  console.error(`\nCompleted: ${successes}/${count} successful`);

  return results;
}

function getCurrentTrafficRate(trafficSchedule, simulatedHour) {
  for (const slot of trafficSchedule) {
    if (simulatedHour >= slot.startHour && simulatedHour < slot.endHour) {
      return slot.instancesPerMinute;
    }
  }
  return 0;
}

function getCurrentErrorRate(trafficSchedule, simulatedHour, defaultErrorRatio) {
  for (const slot of trafficSchedule) {
    if (simulatedHour >= slot.startHour && simulatedHour < slot.endHour) {
      return { rate: slot.errorRatio !== undefined ? slot.errorRatio : defaultErrorRatio, custom: slot.errorRatio !== undefined };
    }
  }
  return { rate: defaultErrorRatio, custom: false };
}

async function runContinuousSimulation(configPath, options = {}) {
  let config;

  if (typeof configPath === 'object') {
    config = configPath;
  } else {
    config = loadConfigSync(configPath);
  }

  if (!config.trafficSchedule || config.trafficSchedule.length === 0) {
    throw new Error('Continuous mode requires a trafficSchedule in the configuration');
  }

  const logger = new JSONLogger();
  const trafficSchedule = config.trafficSchedule.sort((a, b) => a.startHour - b.startHour);

  let totalProcesses = 0;
  let startedProcesses = 0;
  let successfulProcesses = 0;
  let failedProcesses = 0;

  const startRealTime = Date.now();
  let lastMinute = -1;
  let minuteAccumulator = new Map();
  let currentRate = 0;
  const runningProcesses = new Map();

  let wss = null;
  if (options.wsBroadcast) {
    wss = options.wsBroadcast;
  }

  console.error(`Starting continuous simulation...`);
  console.error(`Traffic schedule:`);
  trafficSchedule.forEach(slot => {
    console.error(`  ${slot.startHour.toString().padStart(2, '0')}:00 - ${slot.endHour.toString().padStart(2, '0')}:00 -> ${slot.instancesPerMinute} instances/min`);
  });
  console.error(`\nPress Ctrl+C to stop.\n`);

  const broadcast = (data) => {
    if (wss) {
      const message = JSON.stringify(data);
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    }
  };

  const simulateLoop = () => {
    return new Promise((resolve) => {
      let scheduledProcesses = [];

      const loopId = setInterval(() => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentMinuteKey = currentHour * 60 + currentMinute;
        const errorRateInfo = getCurrentErrorRate(trafficSchedule, currentHour, config.errorRatio);

        if (currentMinuteKey !== lastMinute) {
          lastMinute = currentMinuteKey;
          currentRate = getCurrentTrafficRate(trafficSchedule, currentHour);
          minuteAccumulator.set(currentMinuteKey, currentRate);

          scheduledProcesses = [];

          for (let i = 0; i < currentRate; i++) {
            const delayMs = Math.random() * 59000;
            totalProcesses++;

            const processLogger = new JSONLogger();
            const proc = new Process(config, processLogger, null, errorRateInfo.rate);

            const timeoutId = setTimeout(() => {
              startedProcesses++;
              runningProcesses.set(proc.processId, proc);
              proc.execute().then(result => {
                runningProcesses.delete(proc.processId);
                if (result.success) {
                  successfulProcesses++;
                } else {
                  failedProcesses++;
                }
              }).catch(() => {
                runningProcesses.delete(proc.processId);
                failedProcesses++;
              });
            }, delayMs);

            scheduledProcesses.push(timeoutId);
          }
        }

        const processList = Array.from(runningProcesses.values()).map(p => p.getProgress());
        const stepCounts = {};
        for (const proc of runningProcesses.values()) {
          if (proc.currentStep) {
            stepCounts[proc.currentStep] = (stepCounts[proc.currentStep] || 0) + 1;
          }
        }
        broadcast({
          type: 'stats',
          time: now.toISOString(),
          rate: currentRate,
          scheduled: totalProcesses,
          started: startedProcesses,
          success: successfulProcesses,
          failed: failedProcesses,
          running: startedProcesses - successfulProcesses - failedProcesses,
          errorRate: errorRateInfo.rate,
          errorRateCustom: errorRateInfo.custom,
          stepCounts,
          processList: processList.slice(0, 50)
        });

        if (!options.running) {
          scheduledProcesses.forEach(id => clearTimeout(id));
          clearInterval(loopId);
          resolve();
        }
      }, 100);
    });
  };

  options.running = true;

  const shutdown = () => {
    console.error('\n\nShutting down...');
    options.running = false;
    process.exit(0);
  };

  if (!options.noSignalHandlers) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  await simulateLoop();

  if (!options.noSignalHandlers) {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }

  const elapsedSeconds = (Date.now() - startRealTime) / 1000;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const elapsedRemainder = Math.floor(elapsedSeconds % 60);

  console.error(`\n\nSimulation complete!`);
  console.error(`Real time elapsed: ${elapsedMinutes}m ${elapsedRemainder}s`);
  console.error(`Started: ${startedProcesses}`);
  console.error(`Successful: ${successfulProcesses}`);
  console.error(`Failed: ${failedProcesses}`);
  if (startedProcesses > 0) {
    console.error(`Success rate: ${((successfulProcesses / startedProcesses) * 100).toFixed(2)}%`);
  }

  return { startedProcesses, successfulProcesses, failedProcesses };
}

function startWebViewer(configPath, options = {}) {
  const config = typeof configPath === 'object' ? configPath : loadConfigSync(configPath);

  const staticDir = path.join(__dirname, '..', 'static');
  const htmlPath = path.join(staticDir, 'viewer.html');

  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Viewer HTML not found: ${htmlPath}`);
  }

  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  const configJson = JSON.stringify(config);

  const serverHtml = htmlContent.replace('CONFIG_DATA', configJson);

  const port = options.port || 8123;

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(serverHtml);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.error('WebSocket client connected');
    ws.on('close', () => {
      console.error('WebSocket client disconnected');
    });
  });

  server.listen(port, () => {
    console.log(`\nWeb viewer started at http://localhost:${port}`);
    console.log(`   Process: ${config.name}`);
    console.log(`   Error Rate: ${(config.errorRatio * 100).toFixed(0)}%`);
    console.log(`   Steps: ${config.steps.length}`);
    console.log(`   Press Ctrl+C to stop the server\n`);
  });

  if (config.trafficSchedule && config.trafficSchedule.length > 0) {
    runContinuousSimulation(config, { ...options, running: true, noSignalHandlers: true, wsBroadcast: wss })
      .catch(err => console.error('Simulation error:', err.message));
  } else {
    setInterval(() => {
      runSingleSimulation(config, new JSONLogger())
        .catch(err => console.error('Simulation error:', err.message));
    }, 1000);
  }

  const shutdown = () => {
    console.log('\n\nShutting down...');
    options.running = false;
    wss.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function showUsage() {
  console.log(`
Flow Logs Generator - Business Process Simulator

Usage:
  node src/index.js <config-file>            Run single simulation
  node src/index.js <config-file> -n <num>  Run N simulations
  node src/index.js <config-file> --loop    Run continuous 24h loop
  node src/index.js <config-file> --web     Open web viewer with force-directed graph
  node src/index.js <config-file> --web --port <N>  Custom port (default: 8123)
  node src/index.js <config-file> -o <file> Output logs to file
  node src/index.js --list                  List available configurations

Examples:
  node src/index.js config/order-processing.json
  node src/index.js config/order-processing.json -n 10
  node src/index.js config/order-processing.json --loop
  node src/index.js config/order-processing.json --web
  node src/index.js config/order-processing.json --web --port 8080

Configuration Format (JSON):
  {
    "name": "Process Name",
    "steps": [
      {
        "name": "stepName",
        "avgDuration": 1000,
        "stdDeviation": 100,
        "errorRatio": 0.05,
        "dependencies": ["otherStep"]
      }
    ],
    "trafficSchedule": [
      { "startHour": 0, "endHour": 6, "instancesPerMinute": 2 },
      { "startHour": 6, "endHour": 9, "instancesPerMinute": 10 }
    ]
  }

Traffic Schedule (for continuous mode):
  - Define hourly time boxes with instances per minute rates
  - The simulation will loop through the 24h schedule
  - Each minute, the specified number of process instances are started
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
    process.exit(0);
  }

  if (args[0] === '--list') {
    const configs = listConfigs();
    console.log('Available configurations:');
    configs.forEach(c => console.log(`  ${path.relative(getConfigDir(), c)}`));
    process.exit(0);
  }

  let configPath = args[0];
  let numSimulations = null;
  let outputFile = null;
  let continuousMode = false;
  let webMode = true;
  let webPort = 8123;
  let speed = 60;
  let loop24h = true;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-n' && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      numSimulations = parseInt(args[++i], 10);
    } else if (args[i] === '-o' && i + 1 < args.length) {
      outputFile = args[++i];
    } else if (args[i] === '--loop') {
      continuousMode = true;
    } else if (args[i] === '--web') {
      webMode = true;
    } else if (args[i] === '--port' && i + 1 < args.length) {
      webPort = parseInt(args[++i], 10);
    } else if (args[i] === '--speed' && i + 1 < args.length) {
      speed = parseInt(args[++i], 10);
    } else if (args[i] === '--no-loop' || args[i] === '--once') {
      loop24h = false;
    } else if (!args[i].startsWith('-')) {
      configPath = args[i];
    }
  }

  if (!path.isAbsolute(configPath)) {
    if (configPath.startsWith('config/') || configPath.startsWith('./')) {
      configPath = path.resolve(configPath);
    } else {
      configPath = path.join(getConfigDir(), configPath);
    }
  }

  const options = { outputFile, speed, loop24h, port: webPort };

  if (webMode) {
    startWebViewer(configPath, options);
  } else if (continuousMode) {
    runContinuousSimulation(configPath, options)
      .catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
      });
  } else {
    if (numSimulations === null) {
      numSimulations = 1;
    }
    runMultipleSimulations(configPath, numSimulations, options)
      .catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
      });
  }
}

main();
