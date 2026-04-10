import { Step } from './step.js';
import { generateProcessId } from './utils.js';
import { generateError } from './logger.js';

class Process {
  constructor(config, logger, processId = null, errorRatio = null) {
    this.name = config.name;
    this.steps = config.steps.map(stepConfig => new Step(stepConfig));
    this.errorRatio = errorRatio !== null ? errorRatio : (config.errorRatio || 0);
    this.logger = logger;
    this.completedSteps = new Set();
    this.stepTimings = new Map();
    this.currentStep = null;
    this.startTime = null;
    this.processId = processId || generateProcessId();
    this.status = 'created';
  }

  resolveDependencies(step) {
    return step.dependencies.map(depName => {
      const depStep = this.steps.find(s => s.name === depName);
      if (!depStep) {
        throw new Error(`Dependency "${depName}" not found for step "${step.name}"`);
      }
      return depStep;
    });
  }

  getProgress() {
    const elapsed = this.startTime ? Date.now() - this.startTime : 0;
    return {
      processId: this.processId,
      name: this.name,
      status: this.status,
      currentStep: this.currentStep,
      elapsed,
      stepTimings: Object.fromEntries(this.stepTimings),
      executionPlan: this.executionPlan ? this.executionPlan.map(s => s.name) : []
    };
  }

  async execute() {
    this.startTime = Date.now();
    this.status = 'running';
    
    this.logger.processStarted(this.processId, this.name);
    this.completedSteps.clear();
    this.stepTimings.clear();
    
    this.executionPlan = this.buildExecutionPlan();
    
    let failAtStepIndex = -1;
    let failError = null;
    
    if (Math.random() < this.errorRatio) {
      failAtStepIndex = Math.floor(Math.random() * this.executionPlan.length);
      failError = generateError(this.executionPlan[failAtStepIndex]);
    }
    
    try {
      for (let i = 0; i < this.executionPlan.length; i++) {
        const step = this.executionPlan[i];
        this.currentStep = step.name;
        const shouldFail = i === failAtStepIndex;
        const stepStartTime = Date.now();
        await step.execute(this.processId, this.logger, shouldFail, failError);
        this.stepTimings.set(step.name, Date.now() - stepStartTime);
        this.completedSteps.add(step.name);
        this.currentStep = null;
      }
      
      const totalDuration = Date.now() - this.startTime;
      this.status = 'success';
      this.logger.processCompleted(this.processId, this.name, totalDuration);
      
      return { success: true, processId: this.processId, totalDuration };
    } catch (error) {
      const totalDuration = Date.now() - this.startTime;
      this.status = 'failed';
      const failedStep = this.steps.find(s => !this.completedSteps.has(s.name))?.name;
      this.logger.processFailed(this.processId, this.name, totalDuration, failedStep);
      
      return { success: false, processId: this.processId, totalDuration, error };
    }
  }

  buildExecutionPlan() {
    const plan = [];
    const resolved = new Set();
    const unresolved = new Set(this.steps.map(s => s.name));
    
    let lastSize;
    do {
      lastSize = unresolved.size;
      for (const step of this.steps) {
        if (resolved.has(step.name)) continue;
        
        const depsResolved = step.dependencies.every(dep => resolved.has(dep));
        if (depsResolved) {
          plan.push(step);
          resolved.add(step.name);
          unresolved.delete(step.name);
        }
      }
    } while (unresolved.size > 0 && unresolved.size < lastSize);
    
    if (unresolved.size > 0) {
      const cycleSteps = Array.from(unresolved).join(', ');
      throw new Error(`Circular dependency detected involving: ${cycleSteps}`);
    }
    
    return plan;
  }
}

export { Process };
export default Process;
