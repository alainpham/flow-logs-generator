import { gaussianRandom } from './utils.js';

class Step {
  constructor(config) {
    this.name = config.name;
    this.avgDuration = config.avgDuration || 1000;
    this.stdDeviation = config.stdDeviation || 100;
    this.dependencies = config.dependencies || [];
  }

  async execute(processId, logger, shouldFail = false, failError = null) {
    const startTime = Date.now();
    
    logger.stepStarted(this.name, processId, this.dependencies);
    
    const duration = Math.max(0, gaussianRandom(this.avgDuration, this.stdDeviation));
    
    await new Promise(resolve => setTimeout(resolve, duration));
    
    if (shouldFail) {
      const durationMs = Date.now() - startTime;
      logger.stepFailed(this.name, processId, durationMs, failError);
      throw failError;
    }
    
    const durationMs = Date.now() - startTime;
    logger.stepCompleted(this.name, processId, durationMs);
    
    return { success: true, durationMs };
  }
}

export { Step };
export default Step;
