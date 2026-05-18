function logInfo(...args) {
  console.log('[sog-plan-client]', ...args);
}

function logError(...args) {
  console.error('[sog-plan-client]', ...args);
}

module.exports = {
  logError,
  logInfo,
};
