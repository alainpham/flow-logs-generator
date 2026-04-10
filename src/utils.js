function gaussianRandom(mean = 0, stdDev = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * stdDev + mean;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateProcessId() {
  return Math.random().toString(36).substring(2, 10);
}

export { gaussianRandom, delay, generateProcessId };
