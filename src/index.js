const childProcess = require("child_process");
const Server = require("./server");

function init(argv) {
  if (argv.child) {
    // 子进程服务
  } else {
    const server = new Server(argv);
    server.start();
  }
}

module.exports = init;
