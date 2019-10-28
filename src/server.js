const http = require("http");
const path = require("path");
const fs = require("fs");
const mime = require("mime");
const util = require("util");
const handlebars = require("handlebars");
const color = require("colors/safe");

class Server {
  constructor(argv) {
    this.config = Object.assign({}, this.config, argv);
  }

  //   启动服务器
  start() {
    const server = http.createServer();
    server.on("request", this.request.bind(this));
    server.listen(this.config.port, () => {
      console.log(
        color.green(
          `静态文件服务器启动成功，请访问http://localhost:${this.config.port}`
        )
      );
    });
  }

  // 请求事件
  request(req, res) {
    res.writeHeader(200, { "Content-Type": "text/html" });
    const data = {
      pathName: "/path",
      files: [
        {
          folder: true,
          size: "",
          url: "./folder",
          name: "folder"
        },
        {
          folder: false,
          size: 50,
          url: "./file",
          name: "file"
        }
      ]
    };
    const html = this.template(data);
    res.end(html);
  }

  // 模版文件
  template(data) {
    const html = fs.readFileSync(
      path.resolve(__dirname, "template.html"),
      "utf-8"
    );
    return handlebars.compile(html)(data);
  }
}

module.exports = Server;
