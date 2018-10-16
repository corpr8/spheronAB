"use strict";

/*
* The runner which runs pending spherons and handles things such as propagation persistence (i.e. updating other spherons that they have stuff to do...)
*/

var mongoUtils = require('./mongoUtils.js')
var Spheron = require('./spheron.js')
var udpUtils = require('./udpUtils.js')

//TODO: we need a callback handler for new spherons so that when they 'emit' status messages, we can update our workflow...

var spheron_runner = {
	spheron: null,
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
		},100) //quick
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
			console.log('systemTick: ' + that.systemTick)
			mongoUtils.getNextPendingSpheron(function(result){
				//do tick stuff
				console.log('our pending spheron is: ' + JSON.stringify(result))
				//Note: we should leave this 'in-tick' until we have finished our operations on this spheron.

				//do we have a spheron?
				// --> if so, propagate, backprop signalTraces and check signalTrace set completion...
				if(result != null){
					console.log('we loaded a spheron: ' + JSON.stringify(result))
					that.spheron = new Spheron(result)

					console.log('performing activation and propagation functions.')
					that.processSpheron(0, function(){
						that.inTick = false
					})
				} else {
					//if not:
					// --> increment system tick, inTick = false
					that.systemTick += 1
					that.inTick = false
				}
			})
		}
	},
	processSpheron: function(phaseIdx, callback){
		var that = this
		switch(phaseIdx) {
			case 0:
		        /*
				* Should we mutate?
				*
				* We can make this decision based on the cumulative errors in the exclusion Error map.
				* If the exclusion map is empty, this might also mean we want to mutate (as there are no experiments)
		        */
		        console.log('Phase0: should we mutate?')
		        phaseIdx += 1
		    	this.processSpheron(phaseIdx, callback)
		        break;
			case 1:
		        /*
				* Do we have enough information to fire the spheron?
				* If "sync_inputs_to_sigId" == true, do we have a full set of input signals for any given signal id?
		        * If we cannot find a full set then set the state back to pending and callback from activation
				* 
		        */
		        console.log('Phase1: check if we have enough info in the queue to activate')
		        if(that.spheron.options.sync_inputs_to_sigId == true){
		        	//survey inputMessageQueue and see if we have a set of signals which correspond to a consistent signalId
		        	//if we have a full set then increment the phaseIdx and iterate
		        	//otherwise, set the spheron back to pending and persist it.
		        } else {
		        	//we are ok to Activate as this spheron doesn't need to sync inputs.
			        phaseIdx += 1
			    	this.processSpheron(phaseIdx, callback)
			        break;
		        }
			case 2:
		        /*
		        * Handle Input Messages
		        *
		        * do we have any A/B test scenarios?

		        * Yes => activate with each of the values on the inputs exclusively i.e. bias1 or bias1a but not both.
		        * No => activate
		        * Either way, set output signals onto the propagation message queue - based on either A/B or direct.
		        * Then increment phaseIdx and call this function.
		        */
		        console.log('Phase2: handle input messages')
		        if((that.spheron.exclusionMaps).length > 0){
		        	console.log(that.spheron.exclusionMaps)
		        	console.log('we have variants!')
		        	//todo: - handle them, write the output singalAudits and activate for each combination.

					console.log('back from activating')
					phaseIdx += 1
				   	this.processSpheron(phaseIdx, callback)
		        } else {
		        	console.log('no variants...')
		        	that.activate(function(){
				      	console.log('back from activating')  
				        phaseIdx += 1
				    	that.processSpheron(phaseIdx, callback)
					})
		        }
		        break;
		    case 3:
		        /*
		        * Handle backprop messages
		        *
		        * Copy propagation messages from the que to each of the downstream spherons input message queue
		        * Copy any bpErrorMessageQueue items from the downstream spheron up to this spherons bpErrorMessageQue
		        * Set the downstream spherons state to pending.
		        * Then increment phaseIdx and call this function
		        */
		        console.log('Phase3: handle backprop messages')
		        phaseIdx += 1
		    	this.processSpheron(phaseIdx, callback)
		        break;
		    case 4:
		        /*
		        * Handle multivariant resolution
		        *
		        * If the bpErrorMessage contains any of the connectionId's specified in the exclusionMap, copy that value into the exclusionErrorMap.
		        * If the exclusion error map is full for both sides of a variant, we can calculate which performs best i.e: bias1 [0.1,0.23,0.25,0.39], bias1a [0.11,0.123,0.15,0139] 
		        * bias1a definitely has the lowest errors and should outsurvive bias1
		        * Increment phaseIdx and iterate
		        */
		        console.log('Phase4: handle multi-variant resolution')
		        phaseIdx += 1
		    	this.processSpheron(phaseIdx, callback)
		        break;
		    default:
		    	if(phaseIdx <= 4){
		    		phaseIdx += 1
		    		this.processSpheron(phaseIdx, callback)
		    	} else {
		    		that.persistSpheron(function(){
		    			callback()	
		    		})
		    	}
		}
	},
	activate: function(callback){
		//call the activate function of this spheron
		var that = this

		console.log('running activate')
		this.spheron.activate(null, null, function(thisResult){
			console.log(thisResult)
			callback()	
		})
	},
	persistSpheron: function(callback){
		//TODO: commit this spheron to mongo
		var that = this
		mongoUtils.persistSpheron((that.spheron).spheronId, that.spheron,function(){
			callback()	
		})
	}

}

spheron_runner.init(function(){
	console.log('init complete')

	process.on('SIGINT', function() {
	  console.log('\r\nhandling SIGINT\r\r\n')
	  process.exit();
	});
})