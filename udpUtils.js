var util = require('util')
var EventEmitter = require('events').EventEmitter

const PORT = 20000
const MULTICAST_ADDR = "233.255.255.255"

const dgram = require("dgram")
const process = require("process")

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true })

var udpUtils = function(){
    var that = this
    socket.on("message", function(message, rinfo) {
      //console.log(message, rinfo)
      console.info(`Message from: ${rinfo.address}:${rinfo.port} - ${message}`)
      var rtnMsg = {
        address: rinfo.address,
        port: rinfo.port,
        message: message.toString()
      }
      that.emit('message',rtnMsg)
    })

    this.sendMessage = function(thisMsg){
      //const message = Buffer.from(`Message from process ${process.pid}`);
      const message = Buffer.from(thisMsg)
      socket.send(message, 0, message.length, PORT, MULTICAST_ADDR, function() {
        console.info(`Sending message "${message}"`)
      })
    }
    socket.bind(PORT)

    socket.on("listening", function() {
      socket.addMembership(MULTICAST_ADDR)
      const address = socket.address()
      console.log(`UDP socket listening on ${address.address}:${address.port} pid: ${process.pid}`)
      that.sendMessage('we are online')
    })
}

util.inherits(udpUtils, EventEmitter)
module.exports = udpUtils

  