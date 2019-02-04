"use strict";

/*
* The runner which runs pending spherons and handles things such as propagation persistence (i.e. updating other spherons that they have stuff to do...)
*/
var moduleName = 'runner'
var settings = require('./settings.json')
var Logger = require('./logger.js')
var logger;
var mongoUtils = require('./mongoUtils.js')
var Spheron = require('./spheron.js')
var generateUUID = require('./generateUUID.js')
var multivariator = require('./multivariator.js')
var UdpUtils;
var udpUtils;


//var testData ('./tests/newFormatData1/AND-basicProblemDefinitionV2-nonVariant.json')
//testData: './tests/newFormatData1/basicProblemDefinitionV2-multiVariant.json


var spheron_runner = {
	spheron: null,
	systemTickTimer: null,
	systemTick: null,
	inTick: false,
	init: function(callback){
		var that = this

		logger = new Logger(settings.logOptions)

		//disable UDP if as we are offline...
		if(settings.loadUDP){
			udpUtils = require('./udpUtils.js')
			udpUtils = new UdpUtils()
		}

		mongoUtils.init(function(){
			if(settings.loadTestData == true){
				var testData = require(settings.testData)
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
		return
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
			logger.log(moduleName, 1,'systemTick: ' + that.systemTick)
			mongoUtils.getNextPendingSpheron(that.systemTick, function(result){ 
				if(that.isSpheron(result) == true){
					that.spheron = new Spheron(result, settings.logOptions)
					logger.log(moduleName, 4,'Loaded spheron - starting runtime functions.')
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
				logger.log(moduleName, 2,'Begin Processing a Spheron. Tick is: ' + that.systemTick + " spheron id is: " + this.spheron.spheronId)
		        /*
				* Should we mutate?
				*
				* We can make this decision based on the cumulative errors in the exclusion Error map.
				* If the exclusion map is empty, this might also mean we want to mutate (as there are no experiments)
		        */
		        logger.log(moduleName, 4,'Phase0: should we mutate?')

		        that.mutator(function(){
					that.postPhaseHandler(phaseIdx, callback)
		        })
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
		        logger.log(moduleName, 4,'Phase1: lets handle input queues and activation?')
		        that.inputQueueIterator(function(){
		        	logger.log(moduleName, 4,'finished Phase1.')
		        	logger.log(moduleName, 4,'dump: ' + JSON.stringify(that.spheron))
			        that.postPhaseHandler(phaseIdx, callback)
		        })
		        break;
			case 2:
				/*
				* Handle propagation to downstream spherons...
				*/
				logger.log(moduleName, 4,'Phase2: propagate results to downstream spherons')
				that.propagationQueueIterator(function(){
					logger.log(moduleName, 4,'finished Phase2')
					logger.log(moduleName, 4,'dump: ' + JSON.stringify(that.spheron))
					//Suggest we check the lesson state here and if it is not autoTrain, jump to phase 6
			        that.postPhaseHandler(phaseIdx, callback)
				})
				break;
			case 3:
		        /*
		        * Handle backprop messages
		        * if the lesson is in mode=autoTrain:
		        * Copy any bpErrorMessageQueue items from the downstream spheron up to this spherons bpErrorMessageQue
		        * Set the downstream spherons state to pending.
		        * Then increment phaseIdx and call this function

		        * note: also implements autoAssesment of output answers
		        */
		        logger.log(moduleName, 4,'Phase3: propagating backprop messages for spheron: ' + that.spheron.spheronId)
				that.backpropIterator(null, 0, function(){
					that.postPhaseHandler(phaseIdx, callback)
				})
		        break;
		    case 4:
		        /*
		        * Handle multivariant resolution
		        *
		        * if the lesson is in mode=autoTrain:
		        * If the exclusion error map is full for both sides of a variant, we can calculate which performs best i.e: bias1 [0.1,0.23,0.25,0.39], bias1a [0.11,0.123,0.15,0.139] 
		        * bias1a definitely has the lowest errors and should outsurvive bias1
		        * clear each BackPropMessage as they have now served their purpose
		        * Increment phaseIdx and iterate
		        */
		        logger.log(moduleName, 4,'Phase4: handle multi-variant data storage and resolution')
				that.processCompleteMVTests(function(){
					that.postPhaseHandler(phaseIdx, callback)
				})
				break;
		    case 5:
				/*
			     * Persist spheron to mongo.
			    */
				logger.log(moduleName, 4,'Phase5: persisting this spheron back to mongo...')
		    	that.persistSpheron({updateState: true}, function(){
					that.postPhaseHandler(phaseIdx, callback)
		    	})
		        break;
		    default:
		    	logger.log(moduleName, 4,'in default phase handler (i.e. The fallback.) - phase is: ' + phaseIdx)
		    	if(phaseIdx <= 6){
		    		that.postPhaseHandler(phaseIdx, callback)
		    	} else {
			    	logger.log(moduleName, 4,'Phase6: loading new tests into the spheron')
				    /*
				    * If we are an input spheron and the lesson is still in mode=autoTrain then check if the input queueLength is less than
				    * the number of test states and if so, push more lessons onto the stack.
				    */
					that.maintainTrainingQueue(function(){
						phaseIdx = 0
						if(settings.haltAfterTick == true){
							if(settings.haltAfterTickNo <= that.systemTick){
								logger.exit(function(){
									process.exit()	
								})
							} else {
								callback()
							}
						} else if(settings.haltAfterProcessingSpheron == true){
							if(settings.haltAfterProcessingSpheronId == that.spheron.spheronId){
								logger.exit(function(){
									process.exit()	
								})
							} else {
								callback()
							}
						} else {
							callback()	
						}
					})
		    	}
		}
	},
	postPhaseHandler: function(phaseIdx, callback){
		var that = this
		if(settings.persistAfterPhase[phaseIdx] == true){
			that.persistSpheron({updateState: settings.ifPersistUpdateState[phaseIdx]}, function(){
				process.nextTick(function(){
					phaseIdx += 1
					that.processSpheron(phaseIdx, callback)
				})
			})
		} else {
			phaseIdx += 1
			process.nextTick(function(){
				that.processSpheron(phaseIdx, callback)
			})
		}
	},
	maintainTrainingQueue: function(callback){
		/*
		* 1: Is lesson in training mode? 
		* 2: If yes, Does spheron contain an external input?
		* 3: Get highest tick in the inputQueue
		* - If none, load another batch of tests to all inputs starting at next tick.
		*/

		var that = this
		logger.log(moduleName, 4,that.spheron.problemId)
		mongoUtils.getLessonModeById(that.spheron.problemId, function(currentMode){
			if(currentMode == 'autoTrain'){
				that.hasExternalInput(0,function(hasExtIn){
					if(hasExtIn == true){
						that.searchHighestTickInInputQueue(0, -1, function(highestTick){
							if(highestTick == -1){
								logger.log(moduleName, 4,'we have an empty input queue')
								//we have no inputQueue - load more data
								that.loadNewLessonData(function(){
									callback()
								})
							} else {
								callback()
							}
						})
					} else {
						callback()
					}
				})
			}else {
				callback()
			}
		})
	},
	loadNewLessonData: function(callback){
		//TODO:
		var that = this
		logger.log(moduleName, 4,'problemId is: ' + that.spheron.problemId)
		mongoUtils.getTrainigData(that.spheron.problemId, function(trainingData){
			//trainingData contains the data from the template
			//logger.log(moduleName, 4,JSON.stringify(trainingData))
			//process.exit()


			/*
			*
			*
			[
				{"inputs":{"inputSpheron1":{"input1":{"val":0}},"inputSpheron2":{"input2":{"val":0}}},"outputs":{"outputSpheron1":{"ANDout":{"val":0}}}},
				{"inputs":{"inputSpheron1":{"input1":{"val":1}},"inputSpheron2":{"input2":{"val":0}}},"outputs":{"outputSpheron1":{"ANDout":{"val":0}}}},
				{"inputs":{"inputSpheron1":{"input1":{"val":0}},"inputSpheron2":{"input2":{"val":1}}},"outputs":{"outputSpheron1":{"ANDout":{"val":0}}}},
				{"inputs":{"inputSpheron1":{"input1":{"val":1}},"inputSpheron2":{"input2":{"val":1}}},"outputs":{"outputSpheron1":{"ANDout":{"val":1}}}}
			]
			*
			*
			*
			* that._updateSpheronInputQueue(destinationSpheron, thisMessage, thisTimestamp, function(result){})
			*
			* Valid messages are:
			*
			* {"problemId":"whatIsAnd","path":"input1;bias1;internal1","testIdx":0,"val":-0.17365,"isVariant":true,"sigId":"sigId-123456789"}
			*
			* Process:
			* 1: Generate a sigId (a GUID) and assign to each row of the trainingData
			* 2: Iterate each row
			* 3: Iterate each input
			* 4: Call the 
			* 
			*


			*/
			that.dispatchTrainingDataIterator(0, 0, 0, trainingData, function(){
				logger.log(moduleName, 4,'done iterating new training data')
				//process.exit()
				callback()
			})

		})
	},
	dispatchTrainingDataIterator: function(trainingDataIdx, inputIdx, portIdx, trainingData, callback){
		var that = this
		if(trainingData[trainingDataIdx]){
			if(Object.keys(trainingData[trainingDataIdx].inputs)[inputIdx]){
				if(!trainingData[trainingDataIdx].messageId){
					trainingData[trainingDataIdx].messageId = generateUUID()
				}

				var targetSpheron = Object.keys(trainingData[trainingDataIdx].inputs)[inputIdx]
				logger.log(moduleName, 4,'target spheron: ' + targetSpheron)

				if(Object.keys(trainingData[trainingDataIdx].inputs[targetSpheron])[portIdx]){
					var targetSpheronPort = Object.keys(trainingData[trainingDataIdx].inputs[targetSpheron])[portIdx]
					logger.log(moduleName, 4,'target port: ' + targetSpheronPort)

					var targetValue = trainingData[trainingDataIdx].inputs[targetSpheron][targetSpheronPort].val
					logger.log(moduleName, 4,'port value is: ' + targetValue)

					var thisMessage = {
						"problemId": that.spheron.problemId,
						"path": targetSpheronPort,
						"toPort": targetSpheronPort,
						"testIdx":trainingDataIdx,
						"val": targetValue,
						"isVariant":false,
						"sigId": trainingData[trainingDataIdx].messageId
					}

					logger.log(moduleName, 4,'new message: ' + JSON.stringify(thisMessage))

					that._updateSpheronInputQueue(targetSpheron, thisMessage, that.systemTick +5, function(result){
						that.dispatchTrainingDataIterator(trainingDataIdx, inputIdx, portIdx +1, trainingData, callback)
					})
				} else {
					that.dispatchTrainingDataIterator(trainingDataIdx, inputIdx +1, 0, trainingData, callback)	
				}
			} else {
				that.dispatchTrainingDataIterator(trainingDataIdx +1, 0, portIdx, trainingData, callback)
			}
		} else {
			callback()
		}
	},
	searchHighestTickInInputQueue: function(inputIdx, highestTick, callback){
		var that = this
		if(Object.keys(that.spheron.inputMessageQueue)[inputIdx]){
			if(Object.keys(that.spheron.inputMessageQueue)[inputIdx] > highestTick){
				highestTick = Object.keys(that.spheron.inputMessageQueue)[inputIdx]
				that.searchHighestTickInInputQueue(inputIdx +1, highestTick, callback)
			} else {
				that.searchHighestTickInInputQueue(inputIdx +1, highestTick, callback)
			}
		} else {
			callback(highestTick)
		}
		
	},
	hasExternalInput: function(ioIdx,callback){
		var that = this
		if(that.spheron.io[ioIdx]){
			if(that.spheron.io[ioIdx].type == 'extInput'){
				callback(true)
			} else {
				that.hasExternalInput(ioIdx +1,callback)
			}
		} else {
			callback(false)
		}
	},
	mutator: function(callback){
		/*
		* 1: If in training mode, Decide if we should mutate
		* 2: Decide which mutation
		* 3: setup mutation function as a multi variant.
		*/
		var that = this
		var trainMode = mongoUtils.getLessonModeById(that.spheron.problemId, function(currentMode){
			logger.log(moduleName, 4,'lesson is in ' + currentMode + ' mode')
			if(settings.disableMutation == false){
				if(currentMode == 'autoTrain'){
					if(that.spheron.variantMaps.length < settings.maxTests){ //limit tests to 3 comcurrent right now...
						if( Math.random() > .9){
							that.mutationSelector(function(){
								//TODO: Note - I do not believe that the persist function below is strictly necessary - however, it is good for the debug...
								that.persistSpheron({updateState: false}, function(){
									callback()	
								})
							})
						} else {
							//we won't mutate this spheron this time.
							callback()
						}
					} else {
						callback()
					}
				} else {
					callback()
				}
			} else {
				//we should not mutate as we are a fully trained lesson / problem.
				callback()
			}
		})
	},
	mutationSelector: function(callback){
		//we should mutate - which way?
		var that = this
		switch(Math.floor(Math.random() * 2)) {
			/*
			case 0:
				logger.log(moduleName, 4,'mutation: clone / tweak bias')
				that.cloneTweakBias(function(){
					logger.log(moduleName, 4,'mutation complete. Check it....')
					
					callback()
				})
				break;
			*/	
			case 1:
				logger.log(moduleName, 4,'mutation: clone / tweak connection')
				that.cloneTweakConnection(function(){
					logger.log(moduleName, 4,'mutation complete. Check it....')
					
					callback()
				})
				break;

			default:
				logger.log(moduleName, 4,'TODO: mutation: default exiting for now...')
				callback()
		}
	},
	cloneTweakConnection: function(callback){
		/*
		* 1: Find a connection
		* 2: duplicate / tweak it
		* 3: Find if the connection is part of an existing MV test
		* 4: If yes, extend the test with a new variant.
		* 5: If no, start a new test.
		*/
		var that = this
		that.getRandomConnection(function(thisRandomConnection){
			logger.log(moduleName, 4,'random connection is: ' + thisRandomConnection)
			that.getConnectionDetail(thisRandomConnection, 0, function(currentConnection){
				logger.log(moduleName, 4,'current connection is: ' + JSON.stringify(currentConnection))
				that.isConnectionInMVTest(currentConnection.id, function(isMVTestMemberObject){
					var bugOut = false
					if(isMVTestMemberObject.mvTestIdx != -1){
						if(isMVTestMemberObject.testLength > settings.maxTestItems){
							bugOut = true
						}	
					}

					if(bugOut == true){
						logger.log(moduleName, 4,'bugging out of mutation as we have too much in the test bucket already.')
						callback()
					} else {
						var newConnection = {
							type: currentConnection.type,
							val: -1,
							angle: Math.floor((Math.random() * 360) * 1000) / 1000
						}

						newConnection.id = generateUUID()
						newConnection.path = newConnection.id

						if(currentConnection.type == 'output'){
							newConnection.toId = currentConnection.toId
							newConnection.toPort = currentConnection.toPort
						}

						if(currentConnection.type == 'input'){
							newConnection.fromId = currentConnection.fromId

						}
						newConnection.testIdx = -1
						newConnection.sigId = -1

						logger.log(moduleName, 4,'new connection is: ' + JSON.stringify(newConnection))

						that.pushConnectionToAppropriatePlace(newConnection)

						that.multiVariateTestConnection(isMVTestMemberObject, currentConnection, newConnection, function(){
							callback()
						})
					}
				})
			})
		})
	},
	cloneTweakBias: function(callback){
		/*
		* 1: Find a bias connection
		* 2: duplicate / tweak it
		* 3: Find if the connection is part of an existing MV test
		* 4: If yes, extend the test with a new variant.
		* 5: If no, start a new test.
		*/
		var that = this
		that.getRandomBiasConnection(function(thisRandomBias){

			//TODO: 2.
			logger.log(moduleName, 4,'random bias is: ' + thisRandomBias)
			that.getBiasDetail(thisRandomBias, 0, function(currentBias){
				logger.log(moduleName, 4,'current bias is: ' + JSON.stringify(currentBias))
				var newBias = {}
				if(currentBias != null){
					newBias = JSON.parse(JSON.stringify(currentBias))
				} else {
					newBias.type = 'bias'
					newBias.val = -1
				}

				newBias.angle = Math.floor((Math.random() * 360) * 1000) / 1000
				newBias.id = generateUUID()
				newBias.path = newBias.id

				that.pushConnectionToAppropriatePlace(newBias)

				logger.log(moduleName, 4,'Selected a random bias: ' + thisRandomBias)
				that.multiVariateTestConnection(currentBias, newBias, function(){
					callback()
				})
			})
		})
	},
	multiVariateTestConnection: function(isMVTestMemberObject, existentConnection, newConnection, callback){
		var that = this
		if(typeof existentConnection !== 'undefined'){
			//that.isConnectionInMVTest(existentConnection, function(isMVTestMemberObject){
				logger.log(moduleName, 4,'Connection existent MV Test information: ' + JSON.stringify(isMVTestMemberObject))
				if(isMVTestMemberObject.mvTestIdx == -1){
					//no current test - create one.
					var newTest = []
					newTest.push(existentConnection.id)
					newTest.push(newConnection.id)
					that.spheron.variantMaps.push(newTest)
				} else {
					//curent test - extend it.
					that.spheron.variantMaps[isMVTestMemberObject.mvTestIdx].push(newConnection.id)
				}
				logger.log(moduleName, 4,JSON.stringify(that.spheron))
				//process.exit()
				callback()
			//})
		} else {
			logger.log(moduleName, 4,'as there is no connection currently, we will just add the new one without testing.')
			callback()
		}
	},
	pushConnectionToAppropriatePlace: function(newConnection){
		/*
		* Due to a limitation in the spheron code, things must be pushed to the right place:
		* inputs at the beginning
		* bias in the middle
		* outputs at the end
		*/
		var that = this
		if(newConnection.type == 'input'){
			that.spheron.io.splice(0,0,newConnection)
		} else if(newConnection.type == 'bias'){
			var foundOutput = false
			var ioLength = (that.spheron.io).length
			logger.log(moduleName, 4,(that.spheron.io).length)
			for(var v=0; v<ioLength; v++){
				if((that.spheron.io[v].type == 'output' || that.spheron.io[v].type == 'extOutput') && foundOutput == false){
					foundOutput == true
					that.spheron.io.splice(v,0,newConnection)
				}
			}
		} else {
			that.spheron.io.splice(that.spheron.io.length,0,newConnection)
		}
		return
	},
	isConnectionInMVTest: function(thisConnectionId, callback){
		var that = this
		that.isConnectionInMVTestIterator(thisConnectionId, 0, 0, function(isMVTestMemberObject){
			callback(isMVTestMemberObject)
		})
	},
	isConnectionInMVTestIterator: function(thisConnectionId, mvTestIdx, mvTestItemIdx, callback){
		var that = this
		if(that.spheron.variantMaps[mvTestIdx]){
			logger.log(moduleName, 4,'that.spheron.variantMaps[' + mvTestIdx + ']: ' + that.spheron.variantMaps[mvTestIdx])
			if(that.spheron.variantMaps[mvTestIdx][mvTestItemIdx]){
				logger.log(moduleName, 4,'that.spheron.variantMaps[mvTestIdx][' + mvTestItemIdx + '][' + mvTestItemIdx + ']')
				logger.log(moduleName, 4,'comparing: ' + that.spheron.variantMaps[mvTestIdx][mvTestItemIdx] + ' against: ' + thisConnectionId)
				if(that.spheron.variantMaps[mvTestIdx][mvTestItemIdx] == thisConnectionId){
					logger.log(moduleName, 4,'we found a matching multivariant test')
					callback({mvTestIdx: mvTestIdx, mvTestItemIdx: mvTestItemIdx, testLength: that.spheron.variantMaps[mvTestIdx].length})
				} else {
					that.isConnectionInMVTestIterator(thisConnectionId, mvTestIdx, mvTestItemIdx +1, callback)
				}
			} else {
				that.isConnectionInMVTestIterator(thisConnectionId, mvTestIdx +1, 0, callback)
			}
		} else {
			callback({mvTestIdx: -1, mvTestItemIdx: -1})
		}
	},
	getRandomConnection: function(callback){
		var that = this
		that.getRandomConnectionIterator([], 0, function(connectionId){
			callback(connectionId)
		})
	},
	getRandomConnectionIterator: function(connectionArray, connectionIdx, callback){
		var that = this
		connectionArray = (connectionArray) ? connectionArray : []
		connectionIdx = (connectionIdx) ? connectionIdx : 0
		if(that.spheron.io[connectionIdx]){
			if(that.spheron.io[connectionIdx].type != 'extInput' && that.spheron.io[connectionIdx].type != 'extOutput'){
				connectionArray.push(that.spheron.io[connectionIdx].id)
			}
			that.getRandomConnectionIterator(connectionArray, connectionIdx +1, callback)
		} else {
			//logger.log(moduleName, 4,'biases array is: ' + biasesArray.join(','))
			callback(connectionArray[Math.floor(Math.random() * connectionArray.length)])
		}
	},
	getConnectionDetail: function(connectionId, connIdx, callback){
		var that = this
		connIdx = (connIdx) ? connIdx : 0
		if(that.spheron.io[connIdx]){
			if(that.spheron.io[connIdx].id == connectionId){
				callback(that.spheron.io[connIdx])
			} else {
				that.getConnectionDetail(connectionId, connIdx +1, callback)
			}
		} else {
			callback()
		}
	},
	getRandomBiasConnection: function(callback){
		var that = this
		that.getRandomBiasConnectionIterator([], 0, function(randomBiasId){
			callback(randomBiasId)
		})
	},
	getRandomBiasConnectionIterator: function(biasesArray, connectionIdx, callback){
		var that = this
		biasesArray = (biasesArray) ? biasesArray : []
		connectionIdx = (connectionIdx) ? connectionIdx : 0
		if(that.spheron.io[connectionIdx]){
			if(that.spheron.io[connectionIdx].type == 'bias'){
				biasesArray.push(that.spheron.io[connectionIdx].id)
			}
			that.getRandomBiasConnectionIterator(biasesArray, connectionIdx +1, callback)
		} else {
			//logger.log(moduleName, 4,'biases array is: ' + biasesArray.join(','))
			callback(biasesArray[Math.floor(Math.random() * biasesArray.length)])
		}
	},
	getBiasDetail: function(biasId, connIdx, callback){
		var that = this
		connIdx = (connIdx) ? connIdx : 0
		if(that.spheron.io[connIdx]){
			if(that.spheron.io[connIdx].id == biasId){
				callback(that.spheron.io[connIdx])
			} else {
				that.getBiasDetail(biasId, connIdx +1, callback)
			}
		} else {
			callback()
		}
	},
	processCompleteMVTests: function(callback){
		/*
		* TODO:
		* 1: Find how many test are in the current lesson
		* 2: Find each variant connection set
		* 3: Iterate each member of the set
		* 4: Assess if we have a full set of error results for that variant
		* 5: if not, move onto the next test.
		* 6: else, keep marking.
		* 5: If we do have a full set, clear the error matrix and delete the losing variants.
		*/

		var that = this
		var thisProblemId = that.spheron.problemId
		mongoUtils.getLessonLength(thisProblemId, function(lessonLength){
			logger.log(moduleName, 4,'lesson length: ' + lessonLength)
			that.mvTestIterator(lessonLength, 0, 0, function(){
				callback()
			})
		})	
	},
	mvTestIterator: function(lessonLength, variantMapIdx, variantMapItemIdx, callback){
		logger.log(moduleName, 4,'iterating over tests.')
		var that = this
		variantMapIdx = (variantMapIdx) ? variantMapIdx : 0
		variantMapItemIdx = (variantMapItemIdx) ? variantMapItemIdx : 0
		if(that.spheron.variantMaps[variantMapIdx]){
			logger.log(moduleName, 4,'found a variant map.')
			//we have found a variantError map. We should iterate the items within the map and search for complete sets.
			if(that.spheron.variantMaps[variantMapIdx][variantMapItemIdx]){
				that.countCompletedTestsByConnId(that.spheron.variantMaps[variantMapIdx][variantMapItemIdx], function(resultCount){
					logger.log(moduleName, 4,'resultCount is: ' + resultCount)
					if(resultCount == lessonLength){
						logger.log(moduleName, 4,'found a completed test.')
						that.mvTestIterator(lessonLength, variantMapIdx, variantMapItemIdx +1, callback)
					} else {
						//we failed so look at the next set of variants.
						logger.log(moduleName, 4,'found an incomplete test.')
						that.mvTestIterator(lessonLength, variantMapIdx +1, 0, callback)
					}
				})
			} else {
				//we have hit this point without iterating to the next test so this must be a complete test!
				//TODO: Now splat the test and delete the loser.
				logger.log(moduleName, 4,'all tests completed for a set of variants: ' + that.spheron.variantMaps[variantMapIdx])
				that.determineTestWinner(variantMapIdx, that.spheron.variantMaps[variantMapIdx], function(result){
					callback()	
				})
				
			}
		} else {
			//we have iterated all of the variant maps and haven't found any complete test grids. Shame.
			callback()
		}
	},
	determineTestWinner: function(variantMapIdx, variantMap, callback){
		/*
		* 1: iterate each memeber of the variantMap
		* 2: work out the aggregate error
		* 3: determine the best
		*/

		var that = this
		that.iterateAggregateTestResults(variantMap, 0, {}, function(winner){
			logger.log(moduleName, 2,'our test winner is: ' + winner)
			//TODO: now cleanup the tests, connections, scoring and maps.
			that.cleanupSpheron(variantMapIdx, variantMap, winner, function(){
				logger.log(moduleName, 3,'spheron is house-kept')
				callback()
			})
		})
	},
	cleanupSpheron: function(variantMapIdx, variantMap, winner, callback){
		/*
		* 1: delete any losing connections
		* 2: delete variantErrorMaps for all conenections within this test
		* 3: delete the variantMaps entry
		*/
		var that = this
		logger.log(moduleName, 4,'cleaning up spheron :)')

		that.deleteLosingConnectionsIterator(variantMap, winner, 0, function(){
			that.deleteVariantErrorMapIterator(variantMap, 0, function(){
				that.deleteVariantMapEntry(variantMapIdx, function(){
					callback()
				})
			})
		})
	},
	deleteLosingConnectionsIterator: function(variantMap, winner, variantMapItemIdx, callback){
		var that = this
		logger.log(moduleName, 4,'variant Map is: ' + JSON.stringify(variantMap))
		if(variantMap[variantMapItemIdx]){
			if(variantMap[variantMapItemIdx] != winner){
				that.deleteLosingConnection(variantMap[variantMapItemIdx], 0, function(){
					that.deleteLosingConnectionsIterator(variantMap, winner, variantMapItemIdx +1, callback)
				})
			} else {
				that.deleteLosingConnectionsIterator(variantMap, winner, variantMapItemIdx +1, callback)
			}
		} else {
			callback()
		}
	},
	deleteLosingConnection(connectionId, connectionIdx, callback){
		var that = this
		if(that.spheron.io[connectionIdx]){
			if(that.spheron.io[connectionIdx].id == connectionId){
				 logger.log(moduleName, 4,'deleting connection: ' + that.spheron.io[connectionIdx].id + ' connectionIdx: ' + connectionIdx);
				(that.spheron.io).splice(connectionIdx, 1)
				callback()
			} else {
				that.deleteLosingConnection(connectionId, connectionIdx +1, callback)
			}
		} else {
			callback()
		}
	},
	deleteVariantErrorMapIterator: function(variantMap, variantMapItemIdx, callback){
		var that = this
		if(variantMap[variantMapItemIdx]){
			if(that.spheron.variantErrorMaps[variantMap[variantMapItemIdx]]){
				delete that.spheron.variantErrorMaps[variantMap[variantMapItemIdx]]
				that.deleteVariantErrorMapIterator(variantMap, variantMapItemIdx +1, callback)
			}
		} else {
			callback()
		}
	},
	deleteVariantMapEntry: function(variantMapIdx, callback){
		var that = this
		that.spheron.variantMaps.splice(variantMapIdx,1)
		callback()
	},
	iterateAggregateTestResults: function(variantMap, variantMapItemIdx, aggregateResultObject, callback){
		variantMap = (variantMap) ? variantMap : {}
		variantMapItemIdx = (variantMapItemIdx) ? variantMapItemIdx : 0
		aggregateResultObject = (aggregateResultObject) ? aggregateResultObject : {}
		var that = this
		logger.log(moduleName, 4,'variantMapId is ' + variantMap)
		if(variantMap[variantMapItemIdx]){
			//go through results and store the aggregate in the aggregate object.
			that.findAggregateScoreIterator(variantMap[variantMapItemIdx], 0, 0, function(resultantScore){
				aggregateResultObject[variantMap[variantMapItemIdx]] = resultantScore
				logger.log(moduleName, 4,'aggregate score: ' + resultantScore)
				that.iterateAggregateTestResults(variantMap, variantMapItemIdx +1, aggregateResultObject, callback)	
			})
		} else {
			//we have hit the end of the variants in this set. loop our aggregate object to find the lowest and return it.
			logger.log(moduleName, 4,'aggregate object is: ' + JSON.stringify(aggregateResultObject))
			that.findLowestItemFromAggregateMapIterator(aggregateResultObject, 9999999, null, 0, function(lowestId){
				logger.log(moduleName, 4,'lowest error path is: ' + lowestId)
				callback(lowestId)
			})
		}
	},
	findAggregateScoreIterator: function(connectionId, scoreItemIdx, aggregateScore, callback){
		var that = this
		logger.log(moduleName, 4,'aggregate sofar: ' + aggregateScore)
		if(that.spheron.variantErrorMaps[connectionId][scoreItemIdx]){
			aggregateScore += that.spheron.variantErrorMaps[connectionId][scoreItemIdx]
			aggregateScore = Math.floor(aggregateScore * 1000) / 1000
			that.findAggregateScoreIterator(connectionId, scoreItemIdx +1, aggregateScore, callback)
		} else {
			callback(aggregateScore)
		}
	},
	countCompletedTestsByConnId: function(connectionId, callback){
		var that = this
		var foundResults = 0
		logger.log(moduleName, 4,'this connectionId is: ' + connectionId + ' in spheron: ' + that.spheron.spheronId)
		logger.log(moduleName, 4,'variant map is: ' + JSON.stringify(that.spheron.variantErrorMaps))
		if(that.spheron.variantErrorMaps[connectionId]){
			for(var v=0;v < that.spheron.variantErrorMaps[connectionId].length;v++){
				if(that.spheron.variantErrorMaps[connectionId][v] != null){
					foundResults += 1
				}
			}
			callback(foundResults)
		} else {
			callback(0)
		}
	},
	findLowestItemFromAggregateMapIterator: function(aggregateResultObject, lowestFound, lowestId, objectIdx, callback){
		var that = this
		if(aggregateResultObject[Object.keys(aggregateResultObject)[objectIdx]]){
			logger.log(moduleName, 4,'aggregateObject keys: ' + JSON.stringify(Object.keys(aggregateResultObject)))
			if(aggregateResultObject[Object.keys(aggregateResultObject)[objectIdx]] <= lowestFound){
				lowestFound = aggregateResultObject[Object.keys(aggregateResultObject)[objectIdx]]
				lowestId = Object.keys(aggregateResultObject)[objectIdx]
				logger.log(moduleName, 4,'lowestId: ' + lowestId)
				that.findLowestItemFromAggregateMapIterator(aggregateResultObject, lowestFound, lowestId, objectIdx +1, callback)
			} else {
				that.findLowestItemFromAggregateMapIterator(aggregateResultObject, lowestFound, lowestId, objectIdx +1, callback)
			}
		} else {
			logger.log(moduleName, 4,'assessing if lesson passed')
			mongoUtils.assessIfLessonPassed(that.spheron.problemId, lowestFound, function(assessmentResult){
				if(assessmentResult == 'trained'){
					logger.log(moduleName, 4,'****** We finished training a network! ******')
					if(typeof udpUtils != 'undefined'){
						udpUtils.sendMessage('****** We finished training a network! ******')
					}
				}

				callback(lowestId)	
			})
		}
	},	
	testPushBPErrorToVariantErrorMap: function(inputMsg, callback){
		logger.log(moduleName, 3,'pushing error to error map.')
		var that = this
		logger.log(moduleName, 3,'inputMsg is: ' + JSON.stringify(inputMsg))
		that.testMessageIsSubstringInVariantMaps(0, 0, inputMsg, function(foundId){
			//logger.log(moduleName, 4,'error map:' + foundId)
			if(foundId != null){
				//logger.log(moduleName, 4,'we found a variant match with id: ' + foundId)
				if(!that.spheron.variantErrorMaps[foundId]){
					that.spheron.variantErrorMaps[foundId] = []
				}
				that.spheron.variantErrorMaps[foundId][inputMsg.testIdx] = inputMsg.error
				callback()
			} else {
				callback()
			}
		})
	},
	testMessageIsSubstringInVariantMaps: function(variantIdx, variantGroupIdx, inputMsg, callback){
		//find out if our message contains any of the values within variantMaps for this Spheron
		logger.log(moduleName, 4,'...searching for variantmaps...')
		var that = this

		//logger.log(moduleName, 4,'variantErrorMaps are: ' + (that.spheron.variantErrorMaps).length)

		variantGroupIdx = (variantGroupIdx) ? variantGroupIdx : 0
		variantIdx = (variantIdx) ? variantIdx : 0

		//logger.log(moduleName, 4,that.spheron.spheronId + ': our variant map is: ' + JSON.stringify(that.spheron.variantMaps))
		//process.exit()
		if(that.spheron.variantMaps){
			if(that.spheron.variantMaps[variantGroupIdx]){
				if(that.spheron.variantMaps[variantGroupIdx][variantIdx]){
					var targetSearch = that.spheron.variantMaps[variantGroupIdx][variantIdx] + ';'
					//logger.log(moduleName, 4,'searching for: ' + targetSearch + ' in: ' + JSON.stringify(inputMsg))
					var isIncluded = (inputMsg.path).includes(targetSearch)
					if(isIncluded){
						//logger.log(moduleName, 4,'we found a variant in this spheron')
						callback(that.spheron.variantMaps[variantGroupIdx][variantIdx])
					} else {
						that.testMessageIsSubstringInVariantMaps(variantIdx +1, variantGroupIdx, inputMsg, callback)	
					}
				} else {
					that.testMessageIsSubstringInVariantMaps(0, variantGroupIdx +1, inputMsg, callback)
				}
			} else {
				//logger.log(moduleName, 4,that.spheron.spheronId + ": no variants in variantmap")
				callback()
			}
		} else {
			//no AB tests running so return -1.
			logger.log(moduleName, 4,that.spheron.spheronId + ": no variants key in spheron")
			callback()
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
		if(that.spheron.bpErrorMessageQueue[0] !== undefined){
			var thisBPMessage = that.spheron.bpErrorMessageQueue[0]
			/*
			* TODO: Needs testing and validation.
			*/

			if(upstreamSpheronArray[arrayIdx]){
				logger.log(moduleName, 4,'we have back propagation stuff to process.')


				logger.log(moduleName, 4,'dumping back prop queue')
				for(var v=0;v<that.spheron.bpErrorMessageQueue.length;v++){
					logger.log(moduleName, 4,JSON.stringify(that.spheron.bpErrorMessageQueue[v]))
				}

				//logger.log(moduleName, 4,'back propagation queue is: ' + that.spheron.bpErrorMessageQueue.join(','))
				mongoUtils.getSpheron(upstreamSpheronArray[arrayIdx], function(thisSpheron){
					thisSpheron.bpErrorMessageQueue.push(thisBPMessage)
					mongoUtils.persistSpheron(thisSpheron.spheronId, thisSpheron, function(){
						that.backpropIterator(upstreamSpheronArray, (arrayIdx +1), callback)
					})
				})
			} else {
				// we have finished this line of the BP array

				/*
				* TODO: Now we have to add the error to our error array...
				*/
				logger.log(moduleName, 4,'pushing errors to varianterrormaps for spheron: ' + that.spheron.spheronId)
				that.testPushBPErrorToVariantErrorMap(thisBPMessage, function(){
					that.spheron.bpErrorMessageQueue.shift()
					that.backpropIterator(upstreamSpheronArray, 0, callback)	
				})
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
		logger.log(moduleName, 4,'in propagationQueueIterator')
		that._propagationQueueAgeIterator(function(){
			callback()
		})
	},
	_propagationQueueAgeIterator: function(callback){
		var that = this
		//logger.log(moduleName, 4,Object.keys(that.spheron.propagationMessageQueue)[0])
		//logger.log(moduleName, 4,that.spheron.propagationMessageQueue)
		if(Object.keys(that.spheron.propagationMessageQueue)[0] !== undefined){
			var thisTimestamp = (Object.keys(that.spheron.propagationMessageQueue)[0]).toString()
			//logger.log(moduleName, 4,'ageQueueIdx0: ' + thisTimestamp)
			that._propagationQueueSigIterator(thisTimestamp, function(){
				//logger.log(moduleName, 4,'in _propagationQueueSigIterator callback')
				delete that.spheron.propagationMessageQueue[thisTimestamp]
				callback()
			})
		} else {
			logger.log(moduleName, 4,'propagationMessageQueue[0] is undefined')
			callback()
		}
	},
	_propagationQueueSigIterator: function(thisTimestamp, callback){
		/*
		* TODO: Iterate signalId's within a given timestamp of the propagationQueue
		*/
		var that = this
		logger.log(moduleName, 4,'timestamp is: ' + thisTimestamp)
		if(that.spheron.propagationMessageQueue[thisTimestamp]){
			if(Object.keys((that.spheron.propagationMessageQueue)[thisTimestamp])[0]){
				var thisSigId = Object.keys(that.spheron.propagationMessageQueue[thisTimestamp])[0]

				if(typeof thisSigId != undefined){
					if(that.spheron.propagationMessageQueue[thisTimestamp][thisSigId]){
							that._propagateMessage(thisTimestamp, that.spheron.propagationMessageQueue[thisTimestamp][thisSigId][0], function(){
								logger.log(moduleName, 4,'Deleting message');
								(that.spheron.propagationMessageQueue[thisTimestamp][thisSigId]).shift()
								if(that.spheron.propagationMessageQueue[thisTimestamp][thisSigId].length == 0){
									logger.log(moduleName, 4,'propagation que length for this sigId is 0')
									delete that.spheron.propagationMessageQueue[thisTimestamp][thisSigId]
									that._propagationQueueSigIterator(thisTimestamp, callback)
									//callback()
								} else if(Object.keys(that.spheron.propagationMessageQueue[thisTimestamp])[0] === undefined){
									logger.log(moduleName, 4,'propagation que length for this timestamp is 0')
									delete that.spheron.propagationMessageQueue[thisTimestamp]
									callback()
								} else {
									/*
									* I am not sure that this path is ever used. Why is it here?
									*/
									logger.log(moduleName, 4,'propagation que length for ' + thisTimestamp + ' is: ' + that.spheron.propagationMessageQueue[thisTimestamp].length)
									logger.log(moduleName, 4,'dump of propagation queue: ' + JSON.stringify(that.spheron.propagationMessageQueue[thisTimestamp]))
									that._propagationQueueSigIterator(thisTimestamp, callback)
								}
							})	
					} else {
						logger.log(moduleName, 4,'there is nothing within this timestamp...')
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

		logger.log(moduleName, 4,'propagating: ' + JSON.stringify(thisMessage))
		if(thisMessage){
			var thisPathTail = that._getPathTail(thisMessage.path)
			logger.log(moduleName, 4,'thisPath tail is: ' + thisPathTail)
			that._getConnectionDestinationByConectionId(0, thisPathTail, function(destinationSpheron){
				logger.log(moduleName, 4,'destinationSpheron is: ' + destinationSpheron)
				that._updateSpheronInputQueue(destinationSpheron, thisMessage, thisTimestamp, function(result){
					logger.log(moduleName, 4,'propagated queue item...')
					callback()
				})
			})
		} else {
			callback()
		}
	},
	_findFreeQueueAddress: function(thisSpheron, newTimeStamp, newQueueItem, callback){
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
	_autoAssesor: function(spheronId,newQueueItem,thisTimestamp,callback){
		/*
		* 1: is lesson in autotrain mode?
		* 2: if yes, find actual expected result of testIdx 
		* 3: calculate error
		* 4: construct error message
		* 5: put error message onto backprop queue
		*/
		var that = this
		var trainMode = mongoUtils.getLessonModeById(newQueueItem.problemId, function(currentMode){
			logger.log(moduleName, 4,'lesson is in ' + currentMode + ' mode')
			if(currentMode == 'autoTrain'){
				//get the actual expected value...

				logger.log(moduleName, 4,'Our propagation message is ' + JSON.stringify(newQueueItem))
				mongoUtils.getLessonTestAnswer(newQueueItem.problemId, newQueueItem.testIdx, function(expectedAnswer){
					logger.log(moduleName, 4,'handling expected answer ' + JSON.stringify(expectedAnswer))
					var outputPort = (newQueueItem.path).split(';')[(newQueueItem.path).split(';').length -1]
					logger.log(moduleName, 4,'message port:' + outputPort)
					//finally our health function!!!!
					//push error onto the backpropstack
					logger.log(moduleName, 4,'spheronId: ' + spheronId)
					logger.log(moduleName, 4,'diag: ' + JSON.stringify(expectedAnswer[spheronId]))
					var thisError = Math.floor(Math.abs(newQueueItem.val - (expectedAnswer[spheronId][outputPort].val))*10000)/10000
					logger.log(moduleName, 4,'error:' + thisError)
					var errorMessage = JSON.parse(JSON.stringify(newQueueItem))
					errorMessage.error = thisError
					that.spheron.bpErrorMessageQueue.push(errorMessage)
					callback()
				})
			} else {
				callback()
			}
		})
	},
	typeOfConnection(thisSpheron, connectionId, callback){
		logger.log(moduleName, 4,'searching:' + thisSpheron.spheronId + ' for a connection: ' + connectionId)
		var that = this
		that._typeOfConnectionIterator(thisSpheron, connectionId, 0, function(result){
			callback(result)
		})
	},
	_typeOfConnectionIterator(thisSpheron, targetConnectionId, connectionIdx, callback){
		var that = this
		if(thisSpheron.io[connectionIdx]){
			if(thisSpheron.io[connectionIdx].id == targetConnectionId){
				callback(thisSpheron.io[connectionIdx].type)
			} else {
				that._typeOfConnectionIterator(thisSpheron, targetConnectionId, connectionIdx+1, callback)
			}
		} else {
			callback(false)
		}
	},
	_updateSpheronInputQueue(spheronId, newQueueItem, thisTimestamp, callback){
		var that = this
		logger.log(moduleName, 4,'trying to update spheron with id: ' + spheronId)
		if(spheronId == 'ext'){
			that._autoAssesor(spheronId,newQueueItem,thisTimestamp,function(){
				logger.log(moduleName, 'extOutput','****We have an answer at an output spheron... Lets broadcast this out to the i/o cortex???: ' + JSON.stringify(newQueueItem))
				if(typeof udpUtils != 'undefined'){
					udpUtils.sendMessage(JSON.stringify(newQueueItem))
				}
				
				logger.log(moduleName, 4,'calledback from sendmessage...')
				callback()
			})
		} else {
			logger.log(moduleName, 4,'###thisSpheron: ' + spheronId)
			mongoUtils.getSpheron(spheronId, function(thisSpheron){

				/*
				* Our queue bug is in this section.
				* Currently, when propagating, the spheron does not check:
				* Is the signalId consistent for the target tick?
				* If not, we must find either:
				* 1: A future tick which has this sigId
				* 2: A future tick which is vacant.
				*/
				logger.log(moduleName, 4,'pushing new queue item onto ' + thisSpheron.spheronId + ' :' + JSON.stringify(newQueueItem))
				logger.log(moduleName, 4,thisSpheron.spheronId + ' variantMap is: ' + thisSpheron.variantMaps)
				//logger.log(moduleName, 4,'pushing data onto a spherons input queue: ' + JSON.stringify(thisSpheron))

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

					logger.log(moduleName, 4,'variant Maps: ' + thisSpheron.variantMaps)
					var newQueueItemPathTail = that._getPathTail(newQueueItem.path)
					logger.log(moduleName, 4,'****** new queue path tail:  ' + newQueueItemPathTail)

					//TODO: Now handle the other ones in matchingTest
					thisSpheron.state = "pending"
					thisSpheron.nextTick = Object.keys(thisSpheron.inputMessageQueue)[0]
					if(thisSpheron.nextTick == null){
						thisSpheron.nextTick = that.systemTick +1
					}
					thisSpheron.nextTick = parseInt(thisSpheron.nextTick)
					logger.log(moduleName, 4,'about to persist: ' + JSON.stringify(thisSpheron))
					mongoUtils.persistSpheron(thisSpheron.spheronId, thisSpheron, function(){
						callback()
					})
				})
			})
		}
	},
	/*
	_searchIsVariantInput: function(thisSpheron, queueItemPathTail, callback){
		logger.log(moduleName, 4,'searching to see if we have variants of: ' + queueItemPathTail)
		var that = this
		that._searchIsVariantInputIterator(thisSpheron, 0, 0, queueItemPathTail, function(foundTest){
			if(foundTest != null){
				logger.log(moduleName, 4,'we found a matching variant input queue item: ' + foundTest)
				logger.log(moduleName, 4,'todo: Fire input message to each of the input variants...')
				process.exit()

			} else {
				callback()	
			}
		})
	},
	_searchIsVariantInputIterator: function(thisSpheron, mapIdx, mapItemIdx, queueItemPathTail, callback){
		var that = this
		if(thisSpheron.variantMaps[mapIdx]){
			if(thisSpheron.variantMaps[mapIdx][mapItemIdx]){
				logger.log(moduleName, 4,'testItem is: ' + thisSpheron.variantMaps[mapIdx][mapItemIdx])
				if(thisSpheron.variantMaps[mapIdx][mapItemIdx] == queueItemPathTail){
					callback(thisSpheron.variantMaps[mapIdx])
				} else {
					that._searchIsVariantInputIterator(thisSpheron, mapIdx, mapItemIdx +1, queueItemPathTail, callback)	
				}
			} else {
				that._searchIsVariantInputIterator(thisSpheron, mapIdx +1, 0, queueItemPathTail, callback)
			}
		} else {
			callback()
		}
	},	*/
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
		logger.log(moduleName, 4,'in input queue iterator')
		var that = this
		that._inputMessageQueueAgeIterator(function(){
			logger.log(moduleName, 4,'we returned from our inputMessageQueueAgeIterator')
			callback()
		})
	},
	_inputMessageQueueAgeIterator: function(callback){
		/*
		* Iterate through the top layer (message timestamp) of the inputMessageQueue
		*/
		var that = this
		var oldestMessageAge = that._getOldestTickFromMessageQueue()
		logger.log(moduleName, 4,'oldest message in queue: ' + oldestMessageAge)
		logger.log(moduleName, 4,'system Tick: ' + that.systemTick)

		if(oldestMessageAge != 0 && oldestMessageAge <= that.systemTick){
			that._inputMessageSigIdIterator(oldestMessageAge, function(){
				that._inputMessageQueueAgeIterator(callback)	
			})
		} else {
			logger.log(moduleName, 4,'no processing to be done within the inputMessageQueue')
			callback()
		}
	},
	_inputMessageSigIdIterator: function(timestamp, callback){
		/*
		* Iterate through the second layer (message sigId's) of the inputMessageQueue
		*/
		var that = this
		that._getSigIdFromMessageQueue(timestamp, function(thisSigId){
			logger.log(moduleName, 4,'thisSigId is: ' + thisSigId)
			if(thisSigId){
				if(that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant){
					if(typeof that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0] != 'undefined'){
						var targetInput = ((that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0]).path).split(";")[((that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0]).path).split(";").length -1]
						that._searchUpdateInputIterator(targetInput, that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0], 0, function(){
							logger.log(moduleName, 4,'we updated the input...')
							//that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant.splice(0,1)
							that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant.shift()

							var variantIsNullOrEmpty = false
							if(that.spheron.inputMessageQueue[timestamp][thisSigId].variant) {
								if(that.spheron.inputMessageQueue[timestamp][thisSigId].variant.length == 0 || that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0] == 'undefined'){
									variantIsNullOrEmpty = true	
								}
							} else {
								variantIsNullOrEmpty = true
							}

							var nonVariantIsNullOrEmpty = false
							if(that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant || that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant[0] == 'undefined') {
								if(that.spheron.inputMessageQueue[timestamp][thisSigId].nonVariant.length == 0){
									nonVariantIsNullOrEmpty = true	
								}
							} else {
								nonVariantIsNullOrEmpty = true
							}

							if(nonVariantIsNullOrEmpty && variantIsNullOrEmpty){
								that.activate(thisSigId, function(){
									logger.log(moduleName, 4,"**inputMessageQueue item0: " + Object.keys(that.spheron.inputMessageQueue)[0])
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
				} else if (that.spheron.inputMessageQueue[timestamp][thisSigId].variant.length > 0){
					logger.log(moduleName, 4,'***in the multivariant queue handler...')

					//var targetInput = ((that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0]).path).split(";")[((that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0]).path).split(";").length -1]


					//Test of a new way of addressing input: 
					var targetInput = (that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0]).toPort

					var targetMessage = that.spheron.inputMessageQueue[timestamp][thisSigId].variant[0]



					//New stuff to test...
					multivariator.isVariated(targetMessage.path, that.spheron.variantMaps, function(variatedOutputs){
						if(variatedOutputs != false){



							logger.log(moduleName, 4,that.spheron.spheronId + ' is variated: ' + JSON.stringify(variatedOutputs))	
							that._searchUpdateVariantIterator(variatedOutputs, 0, targetInput, targetMessage, function(){
								(that.spheron.inputMessageQueue[timestamp][thisSigId].variant).shift()
								if(Object.keys(that.spheron.inputMessageQueue)[0]){
									that.spheron.state = "pending"
									that.spheron.nextTick = that.systemTick +1
								} else {
									that.spheron.state = "idle"
								}
								that._inputMessageSigIdIterator(timestamp, callback)

							})


						} else {
							logger.log(moduleName, 4,'targetMessage: ' + JSON.stringify(targetMessage))
							that._searchUpdateInputIterator(targetInput, targetMessage, 0, function(){
								(that.spheron.inputMessageQueue[timestamp][thisSigId].variant).shift()
								that.activate(thisSigId, function(){
									
									logger.log(moduleName, 4,"**inputMessageQueue item0: " + Object.keys(that.spheron.inputMessageQueue)[0])
									if(Object.keys(that.spheron.inputMessageQueue)[0]){
										that.spheron.state = "pending"
										that.spheron.nextTick = that.systemTick +1
									} else {
										that.spheron.state = "idle"
									}
									that._inputMessageSigIdIterator(timestamp, callback)
								})
							})
						}
					})
				} else {
					logger.log(moduleName, 4,'***empty sigId...')
					delete that.spheron.inputMessageQueue[timestamp]
					callback()
				}
			} else {
				logger.log(moduleName, 4,'***no sigId...')
				delete that.spheron.inputMessageQueue[timestamp]
				callback()
			}

		})
	},
	_searchUpdateVariantIterator: function(variatedOutputs, variationIdx, targetInput, targetMessage, callback){
		 var that = this
		if(variatedOutputs.map[variationIdx]){
			var thisTargetMessage = targetMessage
			thisTargetMessage.path.replace(variatedOutputs.id, variatedOutputs.map[variationIdx])
			that._searchUpdateInputIterator(targetInput, thisTargetMessage, 0, function(){
				that._searchUpdateVariantIterator(variatedOutputs, variationIdx +1, targetInput, targetMessage, callback)
			})
			//targetMessage: {"problemId":"whatIsAnd","path":"input1;bias1;internal1","testIdx":0,"val":-0.17365,"isVariant":true,"sigId":"sigId-123456789"}
			
		} else {
			callback()
		}
	},
	_searchUpdateInputIterator: function(targetInput, updateMessage, idx, callback){
		var that = this
		if(idx < that.spheron.io.length){
				if(that.spheron.io[idx].id == targetInput){
					//now we update this input.
					//TODO: extend for pathing.
					logger.log(moduleName, 4,'our updatemessage is: ' + JSON.stringify(updateMessage))
					that.spheron.io[idx].val = updateMessage.val
					that.spheron.io[idx].sigId = updateMessage.sigId
					that.spheron.io[idx].testIdx = updateMessage.testIdx
					that.spheron.io[idx].path = updateMessage.path
					that.spheron.io[idx].isVariant = updateMessage.isVariant
					that.spheron.io[idx].problemId = updateMessage.problemId
					that.spheron.io[idx].testIdx = updateMessage.testIdx
					logger.log(moduleName, 4,'updated connection: ' + JSON.stringify(that.spheron.io[idx]))
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
			logger.log(moduleName, 4,'in _getSigIdFromMessageQueue for timestamp: ' + timestamp + ' : ' + thisSigId)
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
		that.activationIterator(null, 0,0, thisSigId, function(){
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
	activateNonVariant: function(testIdx, thisSigId, callback){
		var that = this
		that.spheron.activate(null, null, function(thisResult){
			that._cleanupInputMessageQueue()

			logger.log(moduleName, 4,"**inputMessageQueue item0: " + Object.keys(that.spheron.inputMessageQueue)[0])
			if(Object.keys(that.spheron.inputMessageQueue)[0]){
				logger.log(moduleName, 4,'will set pending as inputMessageQueue is: ' +JSON.stringify(that.spheron.inputMessageQueue))
				that.spheron.state = "pending"
				that.spheron.nextTick = that.systemTick +1
			} else {
				logger.log(moduleName, 4,'will set idle')
				that.spheron.state = "idle"
			}
			logger.log(moduleName, 4,'In the non variant callback from Activate with this result: ' + JSON.stringify(thisResult))
			var systemTickPlusOne = (parseInt(that.systemTick) +1).toString()
			that.spheron.propagationMessageQueue[systemTickPlusOne] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne] : {}
			that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] : []
			for(var thisKey in thisResult){
				thisResult[thisKey].isVariant = (thisResult[thisKey].isVariant) ? thisResult[thisKey].isVariant : false
				that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId].push({"problemId" : that.spheron.problemId, "path" : thisResult[thisKey].path, "testIdx": thisResult[thisKey].testIdx, "val": thisResult[thisKey].val, "isVariant": thisResult[thisKey].isVariant, "sigId" : thisSigId})
			}
			logger.log(moduleName, 4,"propagation Message Queue is: " + JSON.stringify(that.spheron.propagationMessageQueue))
			logger.log(moduleName, 4,'calling back')
			callback()
		})
	},
	activationIterator:function(variatedMap, mapIdx, testIdx, thisSigId, callback){
		//automatically handle internal A/B - i.e. if this spheron has a variantMap then we need to fire for each (exclusively)
		var that = this
		if(that.spheron.variantMaps.length == 0){
			that.activateNonVariant(testIdx, thisSigId, function(){
				callback()
			})
		} else {
			if(!variatedMap){
				multivariator.multivariate(that.spheron.variantMaps, function(thisVariatedMap){
					logger.log(moduleName, 4,'variating has been done:')
					for(var v=0;v<thisVariatedMap.length;v++){
						logger.log(moduleName, 4,thisVariatedMap[v].join(','))
					}
					logger.log(moduleName, 4,'----')
					that.activationIterator(thisVariatedMap, mapIdx, testIdx, thisSigId, callback)
				})
			} else {
				var systemTickPlusOne = (parseInt(that.systemTick) +1).toString()
				if(mapIdx < variatedMap.length){
					var v = variatedMap[mapIdx].join(',')
					that.spheron.activate(null, v, function(thisResult){
						that._cleanupInputMessageQueue()

						if(Object.keys(that.spheron.inputMessageQueue)[0]){
							that.spheron.state = "pending"
							that.spheron.nextTick = that.systemTick +1
						} else {
							that.spheron.state = "idle"
						}

						logger.log(moduleName, 4,'In the multiVariant callback from Activate with this result: ' + JSON.stringify(thisResult))
						that.spheron.propagationMessageQueue[systemTickPlusOne] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne] : {}
						that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] = (typeof that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] !== 'undefined') ? that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId] : []
						





						for(var thisKey in thisResult){


							that.spheron.propagationMessageQueue[systemTickPlusOne][thisSigId].push({"problemId" : that.spheron.problemId, "path" : thisResult[thisKey].path, "testIdx": thisResult[thisKey].testIdx, "val": thisResult[thisKey].val, "isVariant": true, toPort: thisResult[thisKey].toPort, "sigId" : thisSigId})
							

							logger.log(moduleName, 4,that.spheron.problemId)
						}
						logger.log(moduleName, 4,that.spheron.propagationMessageQueue[systemTickPlusOne])
						that.activationIterator(variatedMap, mapIdx +1, testIdx, thisSigId, callback)
					})
				} else {
					callback()
				}				
			}
		}
	},
	persistSpheron: function(thisOptions, callback){
		//TODO: commit this spheron to mongo
		var that = this
		logger.log(moduleName, 4,Object.keys(that.spheron.inputMessageQueue)[0])
		
		if(thisOptions.updateState == true){
			var oldestMessageAge = that._getOldestTickFromMessageQueue()
			if(oldestMessageAge > that.systemTick){
				this.spheron.state='pending'
				this.spheron.nextTick=that.systemTick +1
			}	
		}
		

		mongoUtils.persistSpheron((that.spheron).spheronId, that.spheron,function(){
			callback()	
		})
	}
}

spheron_runner.init(function(){
	logger.log(moduleName, 4,'init complete')
	process.on('SIGINT', function() {
		logger.log(moduleName, 4,'\r\nhandling SIGINT\r\r\n')
		logger.exit(function(){
			process.exit()	
		})
	});
})