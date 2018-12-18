"use strict";

/*
* The runner which runs pending spherons and handles things such as propagation persistence (i.e. updating other spherons that they have stuff to do...)
*/

var mongoUtils = require('./mongoUtils.js')
var Spheron = require('./spheron.js')
const UdpUtils = require('./udpUtils.js')
var udpUtils = new UdpUtils()

var spheron_runner = {
	spheron: null,
	loadDemoData: false,
	systemTickTimer: null,
	systemTick: null,
	inTick: false,
	init: function(callback){
		var that = this
		mongoUtils.init(function(){
			if(that.loadDemoData == true){
				var testData = require('./tests/newFormatData1/basicProblemDefinitionV2-multiVariant.json')
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
		},100)
		return //as we are not blocking the thread, simply setting stuff up for later.
	},
	stopTicking: function(){
		clearInterval(this.systemTickTimer)
		return
	},
	isSpheron: function(candidate){
		return (candidate.spheronId) ? true : false
	},
	tick: function(){
		var that = this
		if(this.inTick == false){
			this.inTick = true
			/*
			* Here we should be checking for pending spherons...
			*/
			console.log('systemTick: ' + that.systemTick)
			mongoUtils.getNextPendingSpheron(that.systemTick, function(result){ 
				if(that.isSpheron(result) == true){
					that.spheron = new Spheron(result)
					console.log('spheron - runtime functions.')
					that.processSpheron(0, function(){
						that.inTick = false
					})
				} else {
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
				console.log('Begin Processing a Spheron. Tick is: ' + that.systemTick + " spheron id is: " + this.spheron.spheronId)
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
				* if we have variants, set them and call activate individually (setting the correct signal audit) => store the output value on the propagationMessageQueue
				* else just call activate
				* Write each activate and unique signal path to propagation que 
		        */
		        console.log('Phase1: lets handle input queues and activation?')
		        that.inputQueueIterator(function(){
		        	console.log('finished Phase1.')
		        	console.log('dump: ' + JSON.stringify(that.spheron))
			        phaseIdx += 1
				    that.processSpheron(phaseIdx, callback)
				    
		        })
		        break;
			case 2:
				/*
				* Handle propagation to downstream spherons...
				*/
				console.log('Phase2: propagate results to downstream spherons')
				that.propagationQueueIterator(function(){
					console.log('finished Phase2')
					console.log('dump: ' + JSON.stringify(that.spheron))
			        phaseIdx += 1
				    that.processSpheron(phaseIdx, callback)
				})
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
		        console.log('Phase3: handling backprop messages')
				that.backpropIterator(null, 0, function(){
					//process.exit()
					phaseIdx += 1
		    		that.processSpheron(phaseIdx, callback)

				})
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
		        phaseIdx += 1
		    	this.processSpheron(phaseIdx, callback)
		        break;
		    default:
		    	console.log('in default phase handler (i.e. The fallback.) - phase is: ' + phaseIdx)
		    	if(phaseIdx <= 5){
		    		phaseIdx += 1
		    		that.processSpheron(phaseIdx, callback)
		    	} else {
		    		/*
			        * Persist spheron to mongo.
			        */
		        	console.log('Phase6: persisting this spheron back to mongo...')
		    		that.persistSpheron(function(){
		    			phaseIdx = 0
		    			callback()	
		    		})
		    	}
		}
	},
	backpropIterator: function(upstreamSpheronArray, arrayIdx, callback){
		/*
		* TODO: 
		*
		* If we have messages in the bpErrorMessageQueue
		* For each message
		* 1) Iterate inputs and write the message to the spheron on the far end of the input.
		* 2) Update the variantErrorMaps IF the path is part of the errorMap
		* 3) Delete the bpErrorMessageQueue item
		*/
		var that = this

		upstreamSpheronArray = (upstreamSpheronArray) ? upstreamSpheronArray : that.getUpstreamSpherons()
		if(Object.keys(that.spheron.bpErrorMessageQueue)[0] !== undefined){
			var thisBPMessage = that.spheron.bpErrorMessageQueue[0]
			/*
			* TODO: Needs testing and vaslidation.
			*/

			if(upstreamSpheronArray[arrayIdx]){
				console.log('we have back propagation stuff to process.')
				mongoUtils.getSpheron(upstreamSpheronArray[arrayIdx], function(thisSpheron){
					thisSpheron.bpErrorMessageQueue.push(thisBPMessage)
					mongoUtils.persistSpheron(thisSpheron.spheronId, thisSpheron, function(){
						that.backpropIterator(upstreamSpheronArray , (arrayIdx +1), callback)
					})
				})
			} else {
				// we have finished this line of the BP array
				that.spheron.bpErrorMessageQueue.shift()
				that.backpropIterator(upstreamSpheronArray, 0, callback)
			}
		} else {
			callback()
		}
	},
	getUpstreamSpherons: function(){
		var that = this
		var inputsArray = []
		for(var connectionIdx in that.spheron.io){
			if(that.spheron.io[connectionIdx].type == "input"){
				inputsArray.push(that.spheron.io[connectionIdx].fromId)
			}
		}
		return inputsArray
	},
	propagationQueueIterator: function(callback){
		var that = this
		console.log('in propagationQueueIterator')
		that._propagationQueueAgeIterator(function(){
			callback()
		})
	},
	_propagationQueueAgeIterator: function(callback){
		var that = this
		console.log(Object.keys(that.spheron.propagationMessageQueue)[0])
		console.log(that.spheron.propagationMessageQueue)
		if(Object.keys(that.spheron.propagationMessageQueue)[0] !== undefined){
			var thisTimestamp = (Object.keys(that.spheron.propagationMessageQueue)[0]).toString()
			console.log('ageQueueIdx0: ' + thisTimestamp)
			that._propagationQueueSigIterator(thisTimestamp, function(){
				console.log('in _propagationQueueSigIterator callback')
				/*
				* Note: this needs to be tested once we are on terra firma...s
				*/
				delete that.spheron.propagationMessageQueue[thisTimestamp]
				//that._propagationQueueAgeIterator(callback)
				callback()
			})
		} else {
			console.log('propagationMessageQueue[0] is undefined')
			callback()
		}
	},
	_propagationQueueSigIterator: function(thisTimestamp, callback){
		/*
		* TODO: Iterate signalId's within a given timestamp of the propagationQueue
		*/
		var that = this
		console.log('timestamp is: ' + thisTimestamp)
		if(that.spheron.propagationMessageQueue[thisTimestamp]){
			if(Object.keys((that.spheron.propagationMessageQueue)[thisTimestamp])[0]){
				var thisSigId = Object.keys(that.spheron.propagationMessageQueue[thisTimestamp])[0]

				if(typeof thisSigId != undefined){
					if(that.spheron.propagationMessageQueue[thisTimestamp][thisSigId]){
							that._propagateMessage(thisTimestamp, that.spheron.propagationMessageQueue[thisTimestamp][thisSigId][0], function(){
								console.log('Deleting message');
								(that.spheron.propagationMessageQueue[thisTimestamp][thisSigId]).shift()
								if(that.spheron.propagationMessageQueue[thisTimestamp][thisSigId].length == 0){
									console.log('propagation que length for this sigId is 0')
									delete that.spheron.propagationMessageQueue[thisTimestamp][thisSigId]
									that._propagationQueueSigIterator(thisTimestamp, callback)
									//callback()
								} else if(Object.keys(that.spheron.propagationMessageQueue[thisTimestamp])[0] === undefined){
									console.log('propagation que length for this timestamp is 0')
									delete that.spheron.propagationMessageQueue[thisTimestamp]
									callback()
								} else {
									/*
									* I am not sure that this path is ever used. Why is it here?
									*/
									console.log('propagation que length for ' + thisTimestamp + ' is: ' + that.spheron.propagationMessageQueue[thisTimestamp].length)
									console.log('dump of propagation queue: ' + JSON.stringify(that.spheron.propagationMessageQueue[thisTimestamp]))
									that._propagationQueueSigIterator(thisTimestamp, callback)
								}
							})	
					} else {
						console.log('there is nothing within this timestamp...')
						that.spheron.propagationMessageQueue[thisTimestamp][thisSigId] = undefined
						that.spheron.propagationMessageQueue[thisTimestamp] = undefined
						callback()
					}
				} else {
					callback()
				}
			} else {
				callback()
			}
		} else {
			callback()
		}
	},
	_propagateMessage: function(thisTimestamp, thisMessage, callback){
		var that = this
		/*
		* TODO:
		* 1) get tail of path to find the specific output / input connection --done
		* 1a) find connection with id in the tail of the path. Find destination spheron. --done
		* 2) load (but don't run) - that spheron --done
		* 3) push this message onto it's input queue --done
		* 3a) if the input is multi-variant then push it there as well...
		* 4) change its state to pending --done
		* 5) save other spheron --done
		* 6) remove message from output queuem --done
		*/

		console.log('propagating: ' + JSON.stringify(thisMessage))
		if(thisMessage){
			var thisPathTail = that._getPathTail(thisMessage.path)
			console.log('thisPath tail is: ' + thisPathTail)
			that._getConnectionDestinationByConectionId(0, thisPathTail, function(destinationSpheron){
				console.log('destinationSpheron is: ' + destinationSpheron)
				that._updateSpheronInputQueue(destinationSpheron, thisMessage, thisTimestamp, function(result){
					console.log('propagated queue item...')
					callback()
				})
			})
		} else {
			callback()
		}
	},
	_findFreeQueueAddress(thisSpheron, newTimeStamp, newQueueItem, callback){
		var that = this
		if(thisSpheron.inputMessageQueue[newTimeStamp]){
			if(Object.keys(thisSpheron.inputMessageQueue[newTimeStamp])){
				if(Object.keys(thisSpheron.inputMessageQueue[newTimeStamp])[0] == newQueueItem.sigId){
					//Note: As sigId is the same, we will assume testIdx is the same as sigIds should be unique to a testIdx

					callback(newTimeStamp)
				} else {
					newTimeStamp = parseInt(newTimeStamp) + 1
					that._findFreeQueueAddress(thisSpheron, newTimeStamp, newQueueItem, callback)
				}
			} else {
				callback(newTimeStamp)	
			}
		} else {
			callback(newTimeStamp)
		}
	},
	_updateSpheronInputQueue(spheronId, newQueueItem, thisTimestamp, callback){
		var that = this
		console.log('trying to update spheron with id: ' + spheronId)
		if(spheronId == 'ext'){
			/*
			* TODO: We have an output here. We should look into if we are going to emit or check the input Queue and push more lesson data...
			*
			* Emit / update lesson or whatever...
			*/
			console.log('****We have an answer at an output spheron... Lets broadcast this out to the i/o cortex???: ' + JSON.stringify(newQueueItem))

			//broadcast (temporary).
			udpUtils.sendMessage(JSON.stringify(newQueueItem))
				/*
				*
				* should we compare against the plan as stored in the lesson and send a message back?
				*/
				console.log('calledback from sendmessage...')
				callback()
		} else {
			mongoUtils.getSpheron(spheronId, function(thisSpheron){

				/*
				* Our queue bug is in this section.
				* Currently, when propagating, the spheron does not check:
				* Is the signalId consistent for the target tick?
				* If not, we must find either:
				* 1: A future tick which has this sigId
				* 2: A future tick which is vacant.
				*/

				console.log('thisSpheron: ' + JSON.stringify(thisSpheron))

				that._findFreeQueueAddress(thisSpheron, thisTimestamp, newQueueItem, function(newTimeStamp){

					thisSpheron.inputMessageQueue[newTimeStamp] = (thisSpheron.inputMessageQueue[newTimeStamp]) ? thisSpheron.inputMessageQueue[newTimeStamp] : {}
					thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId] = (thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId]) ? thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId] : {}
					thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].nonVariant = (thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].nonVariant) ? thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].nonVariant : []
					thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].variant = (thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].variant) ? thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].variant : []

					if(newQueueItem.isVariant == false){
						thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].nonVariant.push(newQueueItem)
					} else {
						thisSpheron.inputMessageQueue[newTimeStamp][newQueueItem.sigId].variant.push(newQueueItem)
					}

					/*
					* TODO: Check if the connection is multi-variant at the point of entry into the new spheron and if so, set the input message on both connections.
					*/

					thisSpheron.state = "pending"
					
					/*TODO: Or maybe the oldest message time..*/
					thisSpheron.nextTick = that.systemTick +1

					console.log('about to persist: ' + JSON.stringify(thisSpheron))
					mongoUtils.persistSpheron(thisSpheron.spheronId, thisSpheron, function(){
						callback()
					})	
				})
			})
		}
	},
	_getPathTail: function(thisPath){
		return thisPath.split(';')[thisPath.split(';').length -1]
	},
	_getConnectionDestinationByConectionId: function(idx, targetConnId, callback){
		var that = this
		if(that.spheron.io[idx]){
			if(that.spheron.io[idx].id == targetConnId){
				callback(that.spheron.io[idx].toId)
			} else {
				idx += 1
				that._getConnectionDestinationByConectionId(idx,targetConnId,callback)
			}
		} else {
			callback()
		}
	},
	inputQueueIterator: function(callback){
		console.log('in input queue iterator')
		var that = this
		that._inputMessageQueueAgeIterator(function(){
			console.log('we returned from our inputMessageQueueAgeIterator')
			callback()
		})
	},
	_inputMessageQueueAgeIterator: function(callback){
		/*
		* Iterate through the top layer (message timestamp) of the inputMessageQueue
		*/
		var that = this
		var oldestMessageAge = that._getOldestTickFromMessageQueue()
		console.log('oldest message in queue: ' + oldestMessageAge)
		console.log('system Tick: ' + that.systemTick)
		if(oldestMessageAge != 0 && oldestMessageAge <= that.systemTick){
			that._inputMessageSigIdIterator(oldestMessageAge, function(){
				that._inputMessageQueueAgeIterator(callback)	
			})
		} else {
			console.log('no processing to be done within the inputMessageQueue')
			callback()
		}
	},
	_inputMessageSigIdIterator: function(timestamp, callback){
		/*
		* Iterate through the second layer (message sigId's) of the inputMessageQueue
		*/
		var that = this
		that._getSigIdFromMessageQueue(timestamp, function(thisSigId){
			console.log('thisSigId is: ' + thisSigId)
			if(thisSigId){
				if(that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant){
					if(typeof that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0] != 'undefined'){
						var targetInput = ((that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0]).path).split(";")[((that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0]).path).split(";").length -1]
						that._searchUpdateInputIterator(targetInput, that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0], 0, function(){
							console.log('we updated the input...')
							//that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant.splice(0,1)
							that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant.shift()
							if(((that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant).length == 0 ||  that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0] == 'undefined') && (that.spheron.inputMessageQueue[timestamp][thisSigId].variant).length == 0){
								//activate immediately - note activate takes care of internal multivariance...
								that.activate(thisSigId, function(){
									console.log("**inputMessageQueue item0: " + Object.keys(that.spheron.inputMessageQueue)[0])
									if(Object.keys(that.spheron.inputMessageQueue)[0]){
										that.spheron.state = "pending"
										that.spheron.nextTick = that.systemTick +1
									} else {
										that.spheron.state = "idle"
									}
									that._inputMessageSigIdIterator(timestamp, callback)
								})
							} else {
								that._inputMessageSigIdIterator(timestamp, callback)
							}
						})
					} else{
						delete that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant
						that._inputMessageSigIdIterator(timestamp, callback)
					}
					
				} else if (that.spheron.inputMessageQueue[timestamp][thisSigId].variant){
					console.log('***in the multivariant queue handler...')
					var targetInput = ((that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0]).path).split(";")[((that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0]).path).split(";").length -1]
					that._searchUpdateInputIterator(targetInput, that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0], 0, function(){
						(that.spheron.inputMessageQueue[timestamp][thisSigId].variant).shift()
						that.activate(thisSigId, function(){
							console.log("**inputMessageQueue item0: " + Object.keys(that.spheron.inputMessageQueue)[0])
							if(Object.keys(that.spheron.inputMessageQueue)[0]){
								that.spheron.state = "pending"
								that.spheron.nextTick = that.systemTick +1
							} else {
								that.spheron.state = "idle"
							}
							that._inputMessageSigIdIterator(timestamp, callback)
						})
					})
				} else {
					console.log('***no sigId...')
					delete that.spheron.inputMessageQueue[timestamp]
					callback()
				}

			} else {
				console.log('***no sigId...')
				delete that.spheron.inputMessageQueue[timestamp]
				callback()
			}

		})
	},
	_searchUpdateInputIterator: function(targetInput, updateMessage, idx, callback){
		var that = this
		if(idx < that.spheron.io.length){
			if(that.spheron.io[idx].id == targetInput){
				//now we update this input.
				//TODO: extend for pathing.
				console.log('our updatemessage is: ' + JSON.stringify(updateMessage))
				that.spheron.io[idx].val = updateMessage.val
				that.spheron.io[idx].sigId = updateMessage.sigId
				that.spheron.io[idx].testIdx = updateMessage.testIdx
				that.spheron.io[idx].path = updateMessage.path
				that.spheron.io[idx].isVariant = updateMessage.isVariant
				that.spheron.io[idx].problemId = updateMessage.problemId
				that.spheron.io[idx].testIdx = updateMessage.testIdx
				console.log('updated connection: ' + JSON.stringify(that.spheron.io[idx]))
				callback()
			}else {
				idx += 1
				that._searchUpdateInputIterator(targetInput, updateMessage, idx, callback)
			}
		} else {
			callback()
		}
	},
	_getSigIdFromMessageQueue: function(timestamp, callback){
		var that = this
		
		if(that.spheron.inputMessageQueue[timestamp]){
			var thisSigId = Object.keys(that.spheron.inputMessageQueue[timestamp])[0]
			console.log('in _getSigIdFromMessageQueue for timestamp: ' + timestamp + ' : ' + thisSigId)
			callback(thisSigId)
		} else {
			callback()
		}
	},
	_getOldestTickFromMessageQueue: function(){
		var that = this
		return (Object.keys(that.spheron.inputMessageQueue)[0])
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
	activate: function(thisSigId, callback){
		//call the activate function of this spheron
		var that = this
		/*
		* Our new bug - why are we calling a static testIdx in the next statement???????? 
		*/
		that.activationIterator(0,0, thisSigId, function(){
			callback()
		})
	},
	_cleanupInputMessageQueue: function(){
		var that = this
		if(that.spheron.inputMessageQueue[Object.keys(that.spheron.inputMessageQueue)[0]]){
			var auditKey = Object.keys(that.spheron.inputMessageQueue)[0]
			var auditSigId = Object.keys(that.spheron.inputMessageQueue[auditKey])[0]
			if(that.spheron.inputMessageQueue[auditKey][auditSigId].nonVariant){
				if(that.spheron.inputMessageQueue[auditKey][auditSigId].nonVariant.length == 0){
					delete that.spheron.inputMessageQueue[auditKey][auditSigId].nonVariant
				}
			}
			if(that.spheron.inputMessageQueue[auditKey][auditSigId].variant){
				if(that.spheron.inputMessageQueue[auditKey][auditSigId].variant.length == 0){
					delete that.spheron.inputMessageQueue[auditKey][auditSigId].variant
				}
			}

			if(!Object.keys(that.spheron.inputMessageQueue[auditKey][auditSigId])[0]){
				delete that.spheron.inputMessageQueue[auditKey][auditSigId]
			}

			if(!Object.keys(that.spheron.inputMessageQueue[auditKey])[0]){
				delete that.spheron.inputMessageQueue[auditKey]
			}			
		}
		return
	},
	activationIterator:function(mapIdx, testIdx, thisSigId, callback){
		//automatically handle internal A/B - i.e. if this spheron has a variantMap then we need to fire for each (exclusively)
		var that = this
		//console.log(JSON.stringify(that.spheron))
		if(that.spheron.variantMaps.length == 0){
			//console.log('running non-variant activation')
			that.spheron.activate(null, null, function(thisResult){
				that._cleanupInputMessageQueue()

				console.log("**inputMessageQueue item0: " + Object.keys(that.spheron.inputMessageQueue)[0])
				if(Object.keys(that.spheron.inputMessageQueue)[0]){
					console.log('will set pending as inputMessageQueue is: ' +JSON.stringify(that.spheron.inputMessageQueue))
					that.spheron.state = "pending"
					that.spheron.nextTick = that.systemTick +1
				} else {
					console.log('will set idle')
					that.spheron.state = "idle"
				}
				console.log('In the non variant callback from Activate with this result: ' + JSON.stringify(thisResult))
				var systemTickPlusOne = (parseInt(that.systemTick) +1).toString()
				that.spheron.propagationMessageQueue[systemTickPlusOne] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne] : {}
				that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] : []
				for(var thisKey in thisResult){
					thisResult[thisKey].isVariant = (thisResult[thisKey].isVariant) ? thisResult[thisKey].isVariant : false
					that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId].push({"problemId" : that.spheron.problemId, "path" : thisResult[thisKey].path, "testIdx": thisResult[thisKey].testIdx, "val": thisResult[thisKey].val, "isVariant": thisResult[thisKey].isVariant, "sigId" : thisSigId})
				}
				console.log("propagation Message Queue is: " + JSON.stringify(that.spheron.propagationMessageQueue))
				console.log('calling back')
				callback()
			})
		} else {
			var systemTickPlusOne = (parseInt(that.systemTick) +1).toString()
			if(mapIdx < that.spheron.variantMaps.length){
				if(testIdx < that.spheron.variantMaps[mapIdx].length){
					var exclusionMap = that.spheron.variantMaps[mapIdx]
					var v = exclusionMap.slice(0);
					v.splice(testIdx,1)
					that.spheron.activate(null, v, function(thisResult){
			
						that._cleanupInputMessageQueue()

						console.log("**inputMessageQueue item0: " + Object.keys(that.spheron.inputMessageQueue)[0])
						if(Object.keys(that.spheron.inputMessageQueue)[0]){
							that.spheron.state = "pending"
							that.spheron.nextTick = that.systemTick +1
						} else {
							that.spheron.state = "idle"
						}

/*
* Our multi-variant bug is here.
*/

						console.log('In the multiVariant callback from Activate with this result: ' + JSON.stringify(thisResult))
						that.spheron.propagationMessageQueue[systemTickPlusOne] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne] : {}
						that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] : []
						for(var thisKey in thisResult){
							that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId].push({"problemId" : that.spheron.problemId, "path" : thisResult[thisKey].path, "testIdx": thisResult[thisKey].testIdx, "val": thisResult[thisKey].val, "isVariant": true, "sigId" : thisSigId})
							console.log(that.spheron.problemId)
						}
						console.log(that.spheron.propagationMessageQueue[systemTickPlusOne])
						testIdx += 1
						that.activationIterator(mapIdx, testIdx, thisSigId, callback)
					})
				} else {
					mapIdx += 1
					testIdx = 0
					that.activationIterator(mapIdx, testIdx, thisSigId, callback)
				}
			} else {
				callback()
			}
		}
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