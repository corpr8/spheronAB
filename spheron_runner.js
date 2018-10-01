"use strict";

/*
* The runner which runs pending spherons and handles things such as propagation persistence (i.e. updating other spherons that they have stuff to do...)
*/

var mongoUtils = require('./mongoUtils.js')
var spheron = require('./spheron.js')
var udpUtils = require('./udpUtils.js')
var traceUtils = require('./traceUtils.js')



//TODO: we need a callback handler for new spherons so that when they 'emit' status messages, we can update our workflow...

var spheron_runner = {
	loadDemoData: true,
	systemTickTimer: null,
	systemTick: null,
	inTick: false,
	init: function(callback){
		var that = this
		mongoUtils.init(function(){
			if(that.loadDemoData == true){
				var testData = require('./tests/newFormatData1/basicProblemDefinition.json')
				mongoUtils.setupDemoData(testData, function(){
					that.startTicking()
					callback()
				})	
			} else {
				that.startTicking()
				callback()
			}
		})
	},
	startTicking: function(){
		var t = this
		this.systemTick = 0
		this.systemTickTimer = setInterval(function(){
			t.tick()
		},100) //fucking fast.
		return //as we are not blocking the thread, simply setting stuff up for later.
	},
	stopTicking: function(){
		clearInterval(this.systemTickTimer)
		return
	},
	tick: function(){
		var that = this
		if(this.inTick == false){
			this.inTick = true
			/*
			* Here we should be checking for pending spherons...
			*/
			console.log('tick')
			mongoUtils.getNextPendingSpheron(function(result){
				//do tick stuff
				console.log('our pending spheron output was: ' + JSON.stringify(result))
				//Note: we should leave this 'in-tick' until we have finished our operations on this spheron.

				//do we have a spheron?
				// --> if so, propagate, backprop signalTraces and check signalTrace set completion...

				//if not:
				// --> increment system tick, inTick = false




				that.systemTick += 1
				that.inTick = false	
			})
		}
	},
	propagate: function(callback){
		//call the propagate function of this spheron
		//set the input of each downstream spheron
		//set the state of each downstream spheron to pending
		//get the signalTrace from eazch downstream connection and apply it to this specific output.
		callback()
	},
	getDownstreamSignalTrace: function(callback){
		//TODO
		//find downstream Spherons
		//get the input signalTrace from the downstream Spheron
		//apply the signalTrace to this matching output
		callback()
	},
	backprop: function(callback){
		//ask the spheron to backtrace signal errors across this specific spheron
		//i.e: if the trace looks like this at an output [1][2][3]
		// then it looks like this at the bias: [1][2]
		// and like this at i1 [1]

		//for a 2 input gate:
		// [1,2].[3].[4]


		//TODO:
		callback()
	},
	persistSpheron: function(callback){
		//TODO: commit this spheron to mongo
		callback()
	}

}

spheron_runner.init(function(){
	console.log('init complete')

	process.on('SIGINT', function() {
	  console.log('\r\nhandling SIGINT\r\r\n')
	  process.exit();
	});
})