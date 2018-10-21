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
		processedNonVariants = (processedNonVariants) ? processedNonVariants : false

		console.log('in input queue iterator')
		var that = this

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
			/*
			* TODO
			* 
			* This whole for next loop looks seriously dodgy to me...
			* If we are iterating whilst deleting stuff, doesn't that leave us open to missing stuff / double counting????
			* * => we should drop this out to an iterator which doesn't increase idx if we spliced...
			*/
			for(var inputMessageIdx in that.spheron.inputMessageQue){
				if((that.spheron.inputMessageQueue[inputMessageIdx]).isVariant == false){
					(that.spheron.inputMessageQue).splice(inputMessageIdx,1)
				}
			}
			/*
			* end dodgyness
			*/

			//call activation if we have no multi-variant input messages
			if((that.spheron.inputMessageQueue).length == 0){
				console.log('activating based on non multi-variant inputs.')
				that.spheron.activate(null, null, function(){
					/*
					* TODO: we should write the output to the output queue with the relevant signal trace
					*/
					that.inputQueueIterator(true, callback)
				})
			}
		}

		if((that.spheron.inputMessageQueue).length > 0){
			if((that.spheron.exclusionMaps).length > 0){
				//we have a local exlusionMap and should consider if we need to exclude things whilst activating..
				//TODO
				console.log('we havent handled activating spherons with local exlusioon maps yet...')
				/*
				* TODO:
				* Consider if we have a value from the local exlusion map.
				* If yes, we should exclude any of its compliements from this test.
				* then activate as per the next clause.
				*/
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
					/*
					* TODO: we should write the output to the output queue with the relevant signal trace...
					*/
					(that.spheron.inputMessageQueue).shift()
					that.inputQueueIterator(processedNonVariants, callback)
				})
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