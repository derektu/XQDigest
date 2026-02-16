const AppEngine = require('./app-engine');

async function main() {
  const engine = new AppEngine();

  // Graceful shutdown
  const shutdown = () => {
    engine.stop().then(() => {
      process.exit(0);
    }).catch(() => {
      process.exit(1);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await engine.start();
  console.log('Press Ctrl+C to stop.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
