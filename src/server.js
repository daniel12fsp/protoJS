

const net = require('net');
const hexdump = require('./helpers/hexdump');
const { typeOfFrame } = require('./opcode');
const readFrame = require('./readFrame');
const { makeFrameText, makePongFrame } = require('./makeFrame');
const makeHandShake = require('./makeHandShake');


class WebSocketInternal {
  constructor(port, server) {
    this.connectionState = "inicialization";
    this.clients = {};
    const workingServer = server || net.createServer;
    this.server = workingServer(this.handleSocketConnection.bind(this));
    this.server.listen(port, 'localhost');

  }

  handleSocketConnection(socket) {
    const key = socket.remoteAddress + ":" + socket.remotePort;
    socket.name = key;
    socket.status = 'handshake';
    this.clients[key] = socket;
    socket.on('data', (data) => this.onSocketData.apply(this, [data, socket]));
    //TODO on close event send a close Frame
  }

  onSocketData(data, socket) {
    switch (socket.status) {
      case 'handshake':
        makeHandShake(data, socket);
        socket.status = "data";
        this.connectionState = "connect";
        this.socket = socket;
        this.onReady && this.onReady();
        break;
      case 'data':
        this.handleTypeOfFrames(data, socket);
        break;
      default:
        throw new Error("Invalid status");
    }
  }
  isFragmentedFrame(fin) {
    return (fin & 0x80) !== 0x80;
  }

  handleFragmentedFrame(data, opcode) {
    let payloadData;
    this.continuationFrame = this.continuationFrame || {};
    this.continuationFrame.opcode = opcode;
    payloadData = readFrame(data);
    const concatedPayload = Buffer.concat([this.continuationFrame.data || Buffer.from([]), payloadData]);
    this.continuationFrame.data = concatedPayload;
  }
  handleTypeOfFrames(data, socket) {
    const opcode = typeOfFrame(data[0] & 0x0f);
    if (this.isFragmentedFrame(data[0])) {
      this.handleFragmentedFrame(data, opcode);
      return;
    }
    let payloadData;
    switch (opcode) {
      case "continuation":
        payloadData = readFrame(data)
        payloadData = Buffer.concat([this.continuationFrame.data, payloadData]);
        if (this.continuationFrame.opcode === "text") {
          payloadData = payloadData.toString();
        }
        this.onReceive && this.onReceive(payloadData)
        break
      case "text":
        payloadData = readFrame(data).toString();;
        this.onReceive && this.onReceive(payloadData);
        return;
      case "binary":
        payloadData = readFrame(data)
        this.onReceive && this.onReceive(payloadData);
        break
      case "connection-close":
        return;
      case "ping":
        socket.write(makePongFrame());
        break;
      case "pong":
        //TODO read send update last connection
        return;
      default:

    }
  }
  send(data) {
    if (this.socket) {
      this.socket.write(makeFrameText(data))
    } else {
      //TODO problably, it is a good idea to have onReady to send data
      throw new Error("Server is not ready to send data");
    }
  }
  close() {
    this.server.close();
  }
}


class WebSocketServer {
  constructor(port) {
    this.server = new WebSocketInternal(port);
    const handler = {
      set: (obj, prop, value) => {
        switch (prop) {
          case "onReceive":
          case "onReady":
            this.server[prop] = value;
            return true;
          default:
            obj[prop] = value;
            return true;
        }


      }
    };
    return new Proxy(this, handler);
  }
  send(data) {
    this.server.send(data);
  }

  close() {
    this.server.close();
  }
}
module.exports = { WebSocketServer, WebSocketInternal };
