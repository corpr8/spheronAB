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
				var testData = require('./tests/newFormatData1/basicProblemDefinitionV2.json')
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
		this.systemTick = 1
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

		        //TODO: Mutation functions - note they will be additive mutation (either / or)

		        phaseIdx += 1
		    	that.processSpheron(phaseIdx, callback)
		        break;
			case 1:
		        /*
				* Handle Input Messages and Activation as follows:
				*
				* 1: Set any non variant messages as input values to the spheron and delete from queue
				* if we have variants, set them and call activate individually (setting the correct signal audit) => store the output value on the propogationMessageQueue
				* else just call activate
				* Write each activate and unique signal path to propagation que
		        */
		        console.log('Phase1: lets handle input queues and activation?')
		        that.inputQueueIterator(false, function(){
			        phaseIdx += 1
				    that.processSpheron(phaseIdx, callback)
				    
		        })
		        break;
			case 2:
				/*
				* Handle propagation to downstream spherons...
				*/
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
		    case 5:
		        /*
		        * Persist spheron to mongo.
		        */
		        console.log('Phase3: persisting this spheron back to mongo...')

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
	inputQueueIterator: function(processedNonVariants, callback){
		//find oldest timestamp in inputQueue
		//is it less than or equal to our current timestamp
		// => yes
		//	Set all of the non variant values.
		//	Are there any multi Variant values?
		//	  =>yes
		//		iterate them activating each time
		//		set relevant exlculsion map (if the multi-variant is local to this spheron)
		//    => no
		//		Actviate immediately
		//		callback
		//
		// => no - nothing to do for this phase. Callback.


		processedNonVariants = (processedNonVariants) ? processedNonVariants : false

		console.log('in input queue iterator')
		var that = this
		var oldestMessageAge = that._getOldestTickFromMessageQueue()
		console.log('oldest message in queue: ' + oldestMessageAge)
		console.log('system Tick: ' + that.systemTick)
		console.log(oldestMessageAge <= that.systemTick)
		if(oldestMessageAge != 0 && oldestMessageAge <= that.systemTick){
			//we have messages in the input queue
			console.log('we found messages in the inputQueue which are older than our current tick and therefore eligible for processing.')
			if((that.spheron.inputMessageQueue[oldestMessageAge].nonVariant).length > 0){
				//we found some non-variant messages to handle
				
				/*
				* NOte: we have to pay attention to sigId's. TODO - we should actually check if there is anything in the variant message side as well.
				* We should then call a devoted function which sets all messages and activates automatically for variant / nonVariant combinations.
				*/

				for(var thisMessageIdx in that.spheron.inputMessageQueue.nonVariant){
					var targetKey = ((that.spheron.inputMessageQueue[thisMessageIdx]).path).split(";")[((that.spheron.inputMessageQueue[thisMessageIdx]).path).split(";").length -1]
					for(var thisConnectionIdx in that.spheron.io){
						if(that.spheron.io[thisConnectionIdx].id == targetKey){
							that.spheron.io[thisConnectionIdx].val = (that.spheron.inputMessageQueue.nonVariant[thisMessageIdx]).val
						}
					}
				}
				//clear out the non-variant message queue
				for(var thisMessageIdx in that.spheron.inputMessageQueue.nonVariant){
					(that.spheron.inputMessageQueue.nonVariant).splice(0,1)
				}

				if((that.spheron.inputMessageQueue.variant).length == 0){
					//as we only have non-variant messages, we should fire immediately then call back to this function
					console.log('firing')
					process.exit()
				}

			} else {
				//we only have variant messages.

				//don't forget to delete the timestamp key at the end...
			}

		} else {
			//Nothing in the message que to process right now. Time to callback
			callback()
		}
		process.exit()
		
		/*
		if(processedNonVariants == false){
			for(var inputMessageIdx in that.spheron.inputMessageQueue){				
				console.log(that.spheron.inputMessageQueue[inputMessageIdx])
				if((that.spheron.inputMessageQueue[inputMessageIdx]).isVariant == false){
					var targetKey = ((that.spheron.inputMessageQueue[inputMessageIdx]).path).split(";")[((that.spheron.inputMessageQueue[inputMessageIdx]).path).split(";").length -1]
					console.log('setting key:' + targetKey)
					//(that.spheron.io[targetKey]).val = (that.spheron.inputMessageQueue[inputMessageIdx]).val // <--note: we need to iterate the io to find id=targetKey
					for(var thisConnectionIdx in that.spheron.io){
						if(that.spheron.io[thisConnectionIdx].id == targetKey){
							that.spheron.io[thisConnectionIdx].val = (that.spheron.inputMessageQueue[inputMessageIdx]).val
						}
					}
					processedNonVariants = true
				} 
			}
			
			console.log('all non A/B data written to inputs.')

			//iterate and delete anything non-variant.
			that._removeNonVariantIterator(0,function(){

				//call activation if we have no multi-variant input messages
				if((that.spheron.inputMessageQueue).length == 0){
					console.log('activating based on non multi-variant inputs.')
					that.spheron.activate(null, null, function(returnedData){
						console.log('activated: ' + JSON.stringify(returnedData))
						//TODO: we should write the output to the output queue with the relevant signal trace
						that.inputQueueIterator(true, callback)
					})
				} else {
					that.inputQueueIterator(true, callback)
				}
			})
		} else {
			//non variants have been handled.
			if((that.spheron.inputMessageQueue).length > 0){
				if((that.spheron.exclusionMaps).length > 0){
					//we have a local exlusionMap and should consider if we need to exclude things whilst activating..
					//TODO
					console.log('we havent handled activating spherons with local exlusioon maps yet...')
					// TODO:
					// Consider if we have a value from the local exlusion map.
					// If yes, we should exclude any of its compliements from this test.
					// then activate as per the next clause.
				} else {
					//we are ok just to iteratively fire the activate function with no exclusions.
					//set the input value
					var targetKey = ((that.spheron.inputMessageQueue[0]).path).split(";")[((that.spheron.inputMessageQueue[0]).path).split(";").length -1]
					//that.spheron.io[targetKey].val = (that.spheron.inputMessageQueue[inputMessageIdx]).val // <--NOTE: we need to iterate the io to find id=targetKey
					for(var thisConnectionIdx in that.spheron.io){
						if(that.spheron.io[thisConnectionIdx].id == targetKey){
							that.spheron.io[thisConnectionIdx].val = (that.spheron.inputMessageQueue[0]).val
						}
					}

					//activate
					console.log('activate and iterate')
					that.spheron.activate(null,null,function(){
						//TODO: we should write the output to the output queue with the relevant signal trace...
						(that.spheron.inputMessageQueue).shift()
						that.inputQueueIterator(processedNonVariants, callback)
					})
				}
			} else {
				callback()
			}
		}
		*/
	},
	_getOldestTickFromMessageQueue: function(){
		var that = this
		//console.log('diag:' + JSON.stringify(that.spheron.inputMessageQueue))
		return (parseInt(Object.keys(that.spheron.inputMessageQueue)[0]))
	},
	_removeNonVariantIterator: function(idx,callback){
		//Old do not use
		var that = this
		idx = (idx) ? idx : 0
		if(that.spheron.inputMessageQueue[idx]){
			if((that.spheron.inputMessageQueue[idx]).isVariant == false){
				(that.spheron.inputMessageQueue).splice(idx,1)
				that._removeNonVariantIterator(idx,callback)
			} else {
				idx += 1
				that._removeNonVariantIterator(idx,callback)
			}
		} else {
			callback()
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