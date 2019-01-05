"use strict";

/*
* A spheron is a configurable computing unit. It an instance of the active component of a Speheronet.
*/
var add = require('vectors/add')(2)
var mag = require('vectors/mag')(2)
var generateUUID = require('./generateUUID.js')
var heading = require('vectors/heading')(2)
const radToDeg = 180 / Math.PI
const degToRad = Math.PI / 180

var Spheron = function (config) {
	//connections, exclusions, mode, problemId, testLength, testIdx
	this.io = (config.io) ? config.io : {}
	this.signalVector = {}
	this.state = 'idle'
	this.spheronId =  (config.spheronId) ? config.spheronId : "missing" 
	this.problemId = (config.problemId) ? config.problemId : -1 //a global id for the problem that this spheron is trying to solve.
	this.testLength = (config.testLength) ? config.testLength : -1 //how long is the test plan?
	this.testIdx = (config.testIdx) ? config.testIdx : -1 //if we are running a testl what is our current testIdx?
	this.trainingMode = (config.trainingMode) ? config.trainingMode : true //do we actually want to back propagate and evolve? (true)
	this.inputMessageQueue = (config.inputMessageQueue) ? config.inputMessageQueue : [] //activation messsages which are passed to this spheron
	this.variantMaps = (config.variantMaps) ? config.variantMaps : [] //details of ab tests i.e [["bias1", "bias1a", "bias1b"]]
	this.variantErrorMaps = (config.variantErrorMaps) ? config.variantErrorMaps : [] 
	this.propagationMessageQueue = (config.propagationMessageQueue) ? config.propagationMessageQueue : {} //messages waiting to be passed downstream
	this.bpErrorMessageQueue = (config.bpErrorMessageQueue) ? config.bpErrorMessageQueue : [] //backpropped messages waiting to be processed and passed upstream 
	this.exclusionErrorMaps = (config.exclusionErrorMaps) ? config.exclusionErrorMaps : [] //Here we will maintain our understanding of the performance of different variants
	this.options = (config.options) ? config.options : {}
	this.exclusions = (config.exclusions) ? config.exclusions : []
	this.nextTick = (config.nextTick) ? config.nextTick : 0 
}

Spheron.prototype.calculateSignalVector = function(){
	/*
	* Calculates the result vector from adding all inputs or biases together.
	* Note: Not tested with exlusions as yet. Exclusions accepts an array of exclusionId's (specifically for A/B Multivariant)
	*/
	let rv = [0,0]
	let signalTrace = []

	for(var key in this.io) {
		let excludeThis = false
		for(var excludeId in this.exclusions){
			if(this.io[key].id == this.exclusions[excludeId]){
				excludeThis = true
			}
		}
		if(!excludeThis){
			var thisConn = this.io[key]
	        if(thisConn.type == 'input' || thisConn.type == 'bias' || thisConn.type == 'extInput'){
	        	var thisConnCart = this._p2c(thisConn.val,(thisConn.angle * degToRad))
	        	add(rv, thisConnCart)
	        }
		}
    }
    this.signalVector = rv
    return
}

Spheron.prototype.updateInputs = function(inputSignals){
	if(inputSignals){
		for(var key in inputSignals) {
			var thisConnSignal = inputSignals[key]
			for(var connection in this.io){
				if((this.io[connection]).id == key){
					(this.io[connection]).val = thisConnSignal.val
					(this.io[connection]).testIdx = thisConnSignal.testIdx
				}
			}
		}
	}
	return
}

Spheron.prototype.updateExclusions = function(exclusions){
	/*
	* setter for exclusions - should take an array of id's to exclude from proessing.
	*/
	if(exclusions){
		if(Array.isArray(exclusions)){
			this.exclusions = exclusions
		} else {
			this.exclusions = exclusions.split(',')
		}
	}
	return
}

Spheron.prototype.setProblemId = function(problemId){
	this.problemId = problemId
	return
}

Spheron.prototype.activate = function(inputSignals, exclusions, callback){
	/*
	* Activate as above but exclude anything that happens to be in the exclusions array []. 
	* This is useful for propagating signals which are part of an A/B test.
	* update input values - in this instance.
	*/
	var that = this
	if(inputSignals){
		this.updateInputs(inputSignals)	
	}

	if(exclusions){
		this.updateExclusions(exclusions)	
	}

	this.calculateSignalVector()
	var thisResults = {}
	/*
	* now cycle the outputs and add them to thisResults as well as updating their value - if they are not excluded from test
	*/
	var theseOutputs = []
	for(var key in this.io) {
		var thisConn = this.io[key]
		var excludeThis = false
		for(var excludeId in this.exclusions){
			if(this.io[key].id == this.exclusions[excludeId]){
				excludeThis = true
			}
		}
		if(excludeThis == false){
			if(thisConn.type == 'output' || thisConn.type == 'extOutput'){
				theseOutputs.push(thisConn.id)
			}
		}
	}

	for(var key in this.io) {
		var thisConn = this.io[key]
		var excludeThis = false
		for(var excludeId in this.exclusions){
			if(this.io[key].id == this.exclusions[excludeId]){
				excludeThis = true
			}
		}

		if(excludeThis == false){
			console.log('thisConn path: ' + thisConn.path)
			thisConn.path = (thisConn.path !== undefined) ? thisConn.path : thisConn.id
			console.log('thisConn path is now: ' + thisConn.path)
			
			for(var thisOutput in theseOutputs){
				if(typeof thisResults[theseOutputs[thisOutput]] == "undefined"){
					thisResults[theseOutputs[thisOutput]] = {}
				}

				if(typeof thisResults[theseOutputs[thisOutput]].path == "undefined"){
					thisResults[theseOutputs[thisOutput]].path = thisConn.path
				} else {
					thisResults[theseOutputs[thisOutput]].path = thisResults[theseOutputs[thisOutput]].path + ';' + thisConn.path
				}
				thisResults[theseOutputs[thisOutput]].testIdx = that.io[0].testIdx
			}

			if(thisConn.type == 'output' || thisConn.type == 'extOutput'){
				//find signalVector as a polar angle
				var signalVectorHeading = heading(this.signalVector,[0,0])
				var outputHeading = thisConn.angle * degToRad
				var outputAmp = Math.cos(Math.abs(signalVectorHeading - outputHeading))
				var outputFinal = Math.floor((mag(this.signalVector) * outputAmp) * 100000)/100000
				thisConn.val = outputFinal

				/*
				* now apply any output flattening function
				*/
				thisConn.val = that._runOutputFn(thisConn)
				thisResults[that.io[key].id].val = thisConn.val

				console.log(JSON.stringify('***' + JSON.stringify(thisConn)))
				thisResults[that.io[key].id].problemId = thisConn.problemId

				/*does not work currently*/
				thisResults[that.io[key].id].isVariant = thisConn.isVariant
			}
		} else {
			//console.log('we excluded: ' + thisConn.id)
		}
	}
	
	if(callback){
		console.log('calling back from spherons activate function - with these results: ' +  JSON.stringify(thisResults))
		callback(thisResults)
	} else {
		console.log('returning from spherons activate function - with the result: ' +  JSON.stringify(thisResults))
		return thisResults
	}
}

Spheron.prototype._runOutputFn = function(thisConn){
	var that = this
	if(thisConn.outputFn){
		console.log('we had an output function')
		if(that.trainingMode == true && thisConn.outputFn.ignoreWhileTrain == true){
			//nothing to do.
		} else {
			if(thisConn.outputFn.mode == "eq"){
				//tests if equal
				thisConn.val = (thisConn.val == thisConn.outputFn.val) ? 1 : 0
			} else if(thisConn.outputFn.mode == "neq"){
				//tests if not equal
				thisConn.val = (thisConn.val != thisConn.outputFn.val) ? 1 : 0
			} else if(thisConn.outputFn.mode == "neq_nz"){
				//tests if not equal && not zero
				thisConn.val = (thisConn.val != thisConn.outputFn.val && thisConn.val != 0) ? 1 : 0
			} else if(thisConn.outputFn.mode == "sigmoid"){
				//applies the sigmoid flattening function ala traditional neurons.
				//*** To be verified ***
				thisConn.val = 1 / (1 + Math.exp(-thisConn.val))
				//*** end To be verified ***
			} else {
				console.log('output function not handled as yet. Please code it. ')
			}
		}
	}
	return thisConn.val 
}

Spheron.prototype._p2c = function(r, theta){return [(Math.floor((r * Math.cos(theta)) * 100000))/100000, (Math.floor((r * Math.sin(theta)) * 100000))/100000]}

module.exports = Spheron;