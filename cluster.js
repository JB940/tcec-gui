const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
  const cpus = os.cpus().length;

  for (let i = 0; i<1; i++) {
    console.log(`Forking for ${cpus} CPUs`);
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
  if (code !== 0 && !worker.exitedAfterDisconnect) {
    console.log(`Worker ${worker.id} crashed. ` +
                'Starting a new worker...');
    cluster.fork();
  }
});
} else {
  require('./server');
}
