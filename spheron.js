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
	this.connections = (config.io) ? config.io : {}
	this.exclusions = (config.exclusions) ? config.exclusions : []
	this.signalVector = {}
	this.signalTrace = []
	this.stateTickStamp = 0
	this.state = 'idle'
	//optional
	this.problemId = (config.problemId) ? config.problemId : -1 //a global id for the problem that this spheron is trying to solve.
	this.testLength = (config.testLength) ? config.testLength : -1 //how long is the test plan?
	this.testIdx = (config.testIdx) ? config.testIdx : -1 //if we are running a testl what is our current testIdx?
};

Spheron.prototype._calculateSignalTraces = function(){
	//TODO: Write the back propagation of signaltraces across this spheron in the form: [Inputs].[Biases].[Outputs] - which should be recursive...
	return
}

Spheron.prototype.calculateSignalVector = function(){
	/*
	* Calculates the result vector from adding all inputs or biases together.
	* Note: Not tested with exlusions as yet. Exclusions accepts an array of exclusionId's (specifically for A/B Multivariant)
	*/
	let rv = [0,0]
	let signalTrace = []
	for(var key in this.connections) {
		var excludeThis = false
		for(var excludeId in this.exclusions){
			if(key == excludeId){
				excludeThis = true
			}
		}

		if(!excludeThis){
			var thisConn = this.connections[key]
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
	//console.log(inputSignals)
	if(inputSignals){
		for(var key in inputSignals) {
			var thisConnSignal = inputSignals[key]
			//this.connections[key].val = thisConnSignal.val

			for(var connection in this.connections){
				if((this.connections[connection]).id == key){
					(this.connections[connection]).val = thisConnSignal.val
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
		if(Array.isArray(exlusions)){
			this.exclusions = exclusions
		} else {
			console.log("sorry but 'exclusions' should contain an array of id's to be exclude from activation.")
		}
	}
	return
}

Spheron.prototype.setProblemId = function(problemId){
	this.problemId = problemId
	return
}

Spheron.prototype.testLength = function(testLength){
	this.testLength = testLength
	return
}

Spheron.prototype.testIdx = function(testIdx){
	this.testIdx = testIdx
	return
}

Spheron.prototype.activate = function(inputSignals, exclusions, callback){
	/*
	* Activate as above but exclude anything that happens to be in the exclusions array []. 
	* This is useful for propagating signals which are part of an A/B test.
	* update input values - in this instance.
	*/

	//console.log('this spherons connections: ' + JSON.stringify(this.connections))
	//console.log('this spherons signaltrace:' + this.signalTrace)

	if(inputSignals){
		this.updateInputs(inputSignals)	
	}

	if(exclusions){
		this.updateExclusions(exclusions)	
	}

	//console.log('calculate signal traces')
	//this._calculateSignalTraces()

	this.calculateSignalVector()
	var thisResults = {}

	/*
	* now cycle the outputs and add them to thisResults as well as updating their value - if they are not excluded from test
	*/

	for(var key in this.connections) {
		//console.log(this.connections[key])
		var thisConn = this.connections[key]
		
		var excludeThis = false
		for(var excludeId in this.exclusions){
			if(key == excludeId){
				excludeThis = true
			}
		}

		if((thisConn.type == 'output' || thisConn.type == 'extOutput') && excludeThis == false){
			//find signalVector as a polar angle
			var signalVectorHeading = heading(this.signalVector,[0,0])
			var outputHeading = thisConn.angle * degToRad
			var outputAmp = Math.cos(Math.abs(signalVectorHeading - outputHeading))
			var outputFinal = Math.floor((mag(this.signalVector) * outputAmp) * 100000)/100000

			thisConn.val = outputFinal

			/*
			* now apply any output flattening function
			*/
			thisConn.val = this._runOutputFn(thisConn)
			thisResults[this.connections[key].id] = thisConn.val
		}
	}
	this.state = 'idle'
	if(callback){
		callback(thisResults)
	} else {
		return thisResults
	}
}

Spheron.prototype._runOutputFn = function(thisConn){
	if(thisConn.outputFn){
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
			console.log('output function not handled as yet. Please code it.')
		}
	}
	return thisConn.val
}

Spheron.prototype._p2c = function(r, theta){return [(Math.floor((r * Math.cos(theta)) * 100000))/100000, (Math.floor((r * Math.sin(theta)) * 100000))/100000]}

module.exports = Spheron;