// Cached flag check at module load time for zero-cost logging
export const isLogEnabled = (() => {
  if (typeof window !== 'undefined' && (window as any).THREE_TEXT_LOG) {
    return true;
  }

  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as any).process?.env?.THREE_TEXT_LOG === 'true'
  ) {
    return true;
  }

  return false;
})();

class DebugLogger {
  warn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(message, ...args);
  }

  log(message: string, ...args: any[]): void {
    isLogEnabled && console.log(message, ...args);
  }
}

export const debugLogger = new DebugLogger();
