"use strict";

/*
*
* The I/O cortex is resposible for talking to the outside world:
* 
* Upload problem (i.e. a definition of end point spherons and a test plan which must be passed)
* monitor problem
* host webservice endpoing
* host status webpage
*
*/

/*
* Realtime monitoring of processing status / evolution.
* Currently single threaded...
*/

//https://appdividend.com/2018/02/16/node-js-socket-io-tutorial/

const opn = require('opn');
const mongoUtils = require('./mongoUtils.js');
const UdpUtils = require('./udpUtils.js');
var udpUtils = new UdpUtils()
const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const isJSON = require('./isJSON.js')
const server = require('http').createServer(app);
const connections = [];
var io = require('socket.io')(server);

app.use( bodyParser.json() );
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

app.use(express.json());       // to support JSON-encoded bodies
app.use(express.urlencoded()); // to support URL-encoded bodies

app.get('/', function(req, res){
	res.send('Hello World!')	
})

/*
* Endpoint for job uploading.
*/

app.post('/loadProblem', function (req, res) {
	console.log(req.body.jobData)
  	var jobData = JSON.parse(req.body.jobData)
    /*
    * Create Job Metadata file - including testplan
    * Create initial Spheron network
    * Load whole test plan onto activation spherons input queues - with a time based spread...
    * 
    */
  	mongoUtils.importProblem(jobData ,function(){
  		console.log('we have imported a problem definition with associated network network')
      res.send('problem was imported ok. Now check Mongo.')

  		/*
      * TODO: Load testplan onto the input spherons...
  		*/
  		
  	})
})

app.get('/dropDb', function (req, res) {
    mongoUtils.dropDb(function(){
      console.log('we have dropped the db.')
      res.send('ok.')
    })
})

app.use(express.static('public'))

//socket handling for client diagnostics.
io.sockets.on('connection',(socket) => {
   connections.push(socket);
   console.log(' %s sockets is connected', connections.length);

   socket.on('disconnect', () => {
      connections.splice(connections.indexOf(socket), 1);
   });

   socket.on('sending message', (message) => {
      console.log('Message is received :', message);

      io.sockets.emit('new message', {message: message});
   });
});

server.listen(3000, function(){
	console.log('monitor listening on port 3000!')	
})

var ioCortex = {
	init: function(callback){
    /*
    * Do any setup...
    */
		callback()
	}
}

udpUtils.on('message', function(thisMsg){
	console.log(thisMsg)
	io.sockets.emit('new message', {message: thisMsg});
})

mongoUtils.init(function(){
	ioCortex.init(function(){
    // Specify the app to open in
    opn('http://localhost:3000/io.html');
  })
})

