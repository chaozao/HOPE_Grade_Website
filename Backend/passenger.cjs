try {
  require('./server.js');
} catch (error) {
  console.error('Failed to start the HOPE Grade Website API:', error);
  process.exit(1);
}
