/*
 * @Author: chrissong
 * @Date: 2019-10-28 16:14:57
 * @LastEditTime: 2019-10-30 11:02:54
 * @LastEditors: Please set LastEditors
 * @Description: In User Settings Edit
 * @FilePath: /happy-server/src/server.js
 */
const http = require("http");
const path = require("path");
const fs = require("fs");
const mime = require("mime");
const util = require("util");
const url = require("url");
const crypto = require("crypto");
const handlebars = require("handlebars");
const color = require("colors/safe");
const zlib = require("zlib");

class Server {
  constructor(argv) {
    this.config = Object.assign({}, this.config, argv);
  }

  //   启动服务器
  start() {
    const server = http.createServer();
    server.on("request", this._request.bind(this));
    server.listen(this.config.port, () => {
      console.log(
        color.green(
          `静态文件服务器启动成功，请访问http://localhost:${this.config.port}`
        )
      );
    });
  }

  /**
   * 请求事件
   * @param {*} req 请求流
   * @param {*} res 响应流
   */
  _request(req, res) {
    const { pathname } = url.parse(req.url);
    let filepath = path.join(this.config.root, pathname);
    // 如果访问根目录，自动寻找index.html
    if (pathname === "/") {
      const rootPath = path.join(this.config.root, "index.html");
      try {
        const indexStat = fs.statSync(rootPath);
        if (indexStat) filepath = rootPath;
      } catch (e) {}
    }
    fs.stat(filepath, (err, stats) => {
      if (err) {
        this._sendError("not found", req, res);
        return;
      }
      // 判断是否是文件夹
      // 文件夹返回文件列表
      if (stats.isDirectory()) {
        let files = fs.readdirSync(filepath);
        files = files.map(file => {
          const url = path.join(filepath, file);
          const fileStat = fs.lstatSync(url);
          return {
            name: file,
            url: path.join(pathname, file),
            folder: fileStat.isDirectory(),
            size: fileStat.size
          };
        });

        const data = {
          pathName: pathname,
          files: files
        };
        res.setHeader("Content-Type", "text/html");
        res.end(this._template(data));
      } else {
        this._sendfile(req, res, filepath, stats);
      }
    });
  }

  /**
   * 发送文件 点击下载
   * @param {*} req 请求流
   * @param {*} res 响应流
   * @param {*} filepath 文件路径
   * @param {*} stats 文件信息
   */
  _sendfile(req, res, filepath, stats) {
    // 为文件生成hash值
    const sha1 = crypto.createHash("sha1");
    const encoding = this._getEncoding(req, res); // 压缩方式
    const fileStream = fs.createReadStream(filepath);
    fileStream.on("data", data => {
      sha1.update(data);
    });
    fileStream.on("end", () => {
      const hash = sha1.digest("hex");
      //是否走缓存
      if (this._handleCache(req, res, stats, hash)) return;
      res.setHeader("Content-Type", mime.getType(filepath) + ";charset=utf-8");
      const streamData = this._getStream(req, res, filepath, stats);
      if (encoding) {
        streamData.pipe(encoding).pipe(res);
      } else {
        streamData.pipe(res);
      }
    });
  }

  /**
   * 获取压缩格式
   * @param {*} req 请求流
   * @param {*} res 响应流
   */
  _getEncoding(req, res) {
    //Accept-Encoding: gzip, deflate  客户端发送内容，告诉服务器支持哪些压缩格式，服务器根据支持的压缩格式，压缩内容。如服务器不支持，则不压缩。
    const acceptEncoding = req.headers["accept-encoding"];
    if (/\bgzip\b/.test(acceptEncoding)) {
      res.setHeader("Content-Encoding", "gzip");
      return zlib.createGzip();
    } else if (/\bdeflate\b/.test(acceptEncoding)) {
      res.setHeader("Content-Encoding", "deflate");
      return zlib.createDeflate();
    } else {
      return null;
    }
  }

  /**
   * 判断是否用缓存
   * @param {*} req 请求流
   * @param {*} res 响应流
   * @param {*} stats 文件信息
   * @param {*} hash 文件hash值
   */
  _handleCache(req, res, stats, hash) {
    // 需要对比文件修改时间，和设置的过期时间，以及文件的hash值来判断是否走缓存
    // 当资源过期时, 客户端发现上一次请求资源，服务器有发送Last-Modified, 则再次请求时带上if-modified-since
    const ifModifiedSince = req.headers["if-modified-since"];
    // 服务器发送了etag,客户端再次请求时用If-None-Match字段来询问是否过期
    const ifNoneMatch = req.headers["if-none-match"];
    // http1.1内容 max-age=30 为强行缓存30秒 30秒内再次请求则用缓存  private 仅客户端缓存，代理服务器不可缓存
    res.setHeader("Cache-Control", "private,max-age=30");
    // 设置ETag 根据内容生成的hash
    res.setHeader("ETag", hash);
    // 设置Last-Modified 文件最后修改时间
    const lastModified = stats.ctime.toGMTString();
    res.setHeader("Last-Modified", lastModified);

    // 判断是否修改
    if (ifModifiedSince && ifModifiedSince !== lastModified) return false;

    // 判断ETag是否过期
    if (ifNoneMatch && ifNoneMatch !== hash) return false;

    // 如果存在且相等，走缓存
    if (ifModifiedSince && ifNoneMatch) {
      res.writeHead(304);
      res.end();
      return true;
    } else {
      return false;
    }
  }

  /**
   * 错误处理
   * @param {*} err 处理信息
   * @param {*} req 请求流
   * @param {*} res 响应流
   */
  _sendError(err, req, res) {
    res.statusCode = 500;
    res.end(`${err.toString()}`);
  }

  /**
   *断点续传支持
   * @param {*} req
   * @param {*} res
   * @param {*} filepath
   * @param {*} stats
   */
  _getStream(req, res, filepath, stats) {
    let start = 0;
    let end = stats.size ? stats.size - 1 : 0;
    const range = req.headers["range"];
    if (range) {
      res.setHeader("Accept-Range", "bytes");
      res.statusCode = 206;
      let result = range.match(/bytes=(\d*)-(\d*)/);
      if (result) {
        start = isNaN(result[1]) ? start : parseInt(result[1]);
        end = isNaN(result[2]) ? end : parseInt(result[2]) - 1;
      }
    }
    return fs.createReadStream(filepath, { start, end });
  }

  // 模版文件
  _template(data) {
    const html = fs.readFileSync(
      path.resolve(__dirname, "template.html"),
      "utf-8"
    );
    return handlebars.compile(html)(data);
  }
}

module.exports = Server;
