/**
 * Stream Error Utilities
 * Classifies network errors and formats user-friendly messages
 *
 * Problem: Technical error messages confuse users
 * Solution: Classify errors and provide localized, actionable messages
 */

export interface ClassifiedError {
  type: string;
  message: string;
}

/**
 * Classify a stream error and return user-friendly message
 *
 * @param error - The error object
 * @returns Classified error with type and localized message
 */
export function classifyStreamError(error: Error): ClassifiedError {
  const msg = error.message.toLowerCase();

  if (msg.includes('timeout') || msg.includes('timedout')) {
    return {
      type: 'timeout_error',
      message: 'Request timed out. Please check your network connection or try again later.',
    };
  }

  if (msg.includes('econnrefused') || msg.includes('connect')) {
    return {
      type: 'connection_error',
      message: 'Unable to connect to server. Please check your network.',
    };
  }

  if (msg.includes('enotfound') || msg.includes('network') || msg.includes('dns')) {
    return {
      type: 'network_error',
      message: 'Network connection failed. Please check your network settings.',
    };
  }

  if (msg.includes('socket') || msg.includes('aborted') || msg.includes('reset')) {
    return {
      type: 'stream_error',
      message: 'Data transfer interrupted. Please try again later.',
    };
  }

  return {
    type: 'unknown_error',
    message: `Unknown error occurred: ${error.message.substring(0, 100)}`,
  };
}

/**
 * Format error as SSE event for Claude protocol
 *
 * @param errorType - Error type string
 * @param message - User-friendly message
 * @returns SSE-formatted error event string
 */
export function formatErrorForSSE(errorType: string, message: string): string {
  const errorEvent = {
    type: 'error',
    error: {
      type: errorType,
      message: message,
      code: 'stream_error',
    },
  };

  return `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`;
}
