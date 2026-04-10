import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadConfig(configPath) {
  const fullPath = path.resolve(configPath);
  
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${fullPath}`);
  }
  
  const ext = path.extname(fullPath).toLowerCase();
  
  if (ext === '.js') {
    const config = await import(fullPath);
    return config.default;
  } else if (ext === '.json') {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content);
  } else {
    throw new Error(`Unsupported configuration format: ${ext}`);
  }
}

function loadConfigSync(configPath) {
  const fullPath = path.resolve(configPath);
  
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${fullPath}`);
  }
  
  const ext = path.extname(fullPath).toLowerCase();
  
  if (ext === '.js') {
    return import(fullPath).then(m => m.default);
  } else if (ext === '.json') {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content);
  } else {
    throw new Error(`Unsupported configuration format: ${ext}`);
  }
}

function getConfigDir() {
  return path.join(__dirname, '..', 'config');
}

function listConfigs() {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    return [];
  }
  return fs.readdirSync(configDir)
    .filter(f => f.endsWith('.json') || f.endsWith('.js'))
    .map(f => path.join(configDir, f));
}

export { loadConfig, loadConfigSync, getConfigDir, listConfigs };
