import fs from 'fs';

class JSONLogger {
  constructor(outputStream = process.stdout) {
    this.output = outputStream;
  }

  log(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...event
    };
    const line = JSON.stringify(entry) + '\n';
    this.output.write(line);
  }

  stepStarted(stepName, processId, dependencies = []) {
    this.log({
      type: 'STEP_STARTED',
      stepName,
      processId,
      dependencies
    });
  }

  stepCompleted(stepName, processId, durationMs) {
    this.log({
      type: 'STEP_COMPLETED',
      stepName,
      processId,
      durationMs,
      status: 'SUCCESS'
    });
  }

  stepFailed(stepName, processId, durationMs, error) {
    this.log({
      type: 'STEP_FAILED',
      stepName,
      processId,
      durationMs,
      status: 'ERROR',
      error_message: error.message,
      error_code: error.code || 'UNKNOWN_ERROR',
      error_recoverable: error.recoverable || false,
      error_context: error.context || {}
    });
  }

  processStarted(processId, processName) {
    this.log({
      type: 'PROCESS_STARTED',
      processId,
      processName
    });
  }

  processCompleted(processId, processName, totalDurationMs) {
    this.log({
      type: 'PROCESS_COMPLETED',
      processId,
      processName,
      totalDurationMs,
      status: 'SUCCESS'
    });
  }

  processFailed(processId, processName, totalDurationMs, failedStep) {
    this.log({
      type: 'PROCESS_FAILED',
      processId,
      processName,
      totalDurationMs,
      status: 'FAILED',
      failedStep
    });
  }

  createFileLogger(filePath) {
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    return new JSONLogger(stream);
  }
}

const errorMessages = {
  TIMEOUT: 'The operation exceeded the maximum allowed time',
  VALIDATION: 'Input validation failed',
  NETWORK: 'Network request failed',
  DATABASE: 'Database operation failed',
  AUTHENTICATION: 'Authentication failed',
  AUTHORIZATION: 'Authorization denied',
  RESOURCE_NOT_FOUND: 'Required resource not found',
  RATE_LIMIT: 'Rate limit exceeded',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
  INTERNAL_ERROR: 'Internal server error occurred',
  CONFIGURATION: 'Configuration error detected',
  DEPENDENCY_FAILED: 'Dependency step failed'
};

const errorCodes = Object.keys(errorMessages);

function generateError(stepConfig) {
  const code = errorCodes[Math.floor(Math.random() * errorCodes.length)];
  const baseMessage = errorMessages[code];
  
  const contextVariations = {
    TIMEOUT: { timeout: 30000, endpoint: `http://api.example.com/${stepConfig.name}` },
    VALIDATION: { field: ['email', 'password', 'username'][Math.floor(Math.random() * 3)], value: null },
    NETWORK: { host: 'api.example.com', port: 443, attempt: Math.floor(Math.random() * 3) + 1 },
    DATABASE: { query: `SELECT * FROM ${stepConfig.name}`, connectionId: `conn_${Math.random().toString(36).substr(2, 9)}` },
    AUTHENTICATION: { userId: `user_${Math.floor(Math.random() * 10000)}`, method: ['basic', 'bearer', 'api-key'][Math.floor(Math.random() * 3)] },
    AUTHORIZATION: { requiredRole: 'admin', currentRole: 'user' },
    RESOURCE_NOT_FOUND: { resourceType: 'entity', resourceId: Math.floor(Math.random() * 1000) },
    RATE_LIMIT: { limit: 100, remaining: 0, resetTime: Date.now() + 60000 },
    SERVICE_UNAVAILABLE: { service: stepConfig.name, retryAfter: 5 },
    INTERNAL_ERROR: { handler: `${stepConfig.name}Handler`, incidentId: `INC-${Math.random().toString(36).substr(2, 9).toUpperCase()}` },
    CONFIGURATION: { key: `${stepConfig.name}.config`, value: undefined },
    DEPENDENCY_FAILED: { dependencyName: stepConfig.dependencies?.[0] || 'unknown' }
  };

  const error = new Error(baseMessage);
  error.code = code;
  error.context = contextVariations[code] || {};
  error.recoverable = ['TIMEOUT', 'NETWORK', 'RATE_LIMIT', 'SERVICE_UNAVAILABLE'].includes(code);
  
  return error;
}

export { JSONLogger, generateError, errorMessages };
export default JSONLogger;
