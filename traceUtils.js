"use strict";
/*
* Handles manipulating signal trace messages to return different elements or insert stuff into an existent message.
*
* A single spherons trace strings looks like [[inputs][biases][outputs]] - when viewed from an output
*
* Where each input, bias or output may also be: [[][][]]
*
*/

var traceUtils = {
	convertStringToSpheronNotation: function(inputString, callback){
		this.convertStringToFirstLevelArray(inputString, function(result){
			callback(result)
		})
	},
	convertStringToFirstLevelArray: function(inputString, callback){
		//output an array corresponding to: inputs, biases and outputs - i.e: [[inputs],[biases],[outputs]]
		var outputArray = []
		var depth = 0
		var thisTermstart = 0
		for (var v=0; v< inputString.length; v++) {
		  if(inputString[v] == '['){ 
		  	depth += 1
		  	if(depth == 1){
		  		thisTermstart = v +1	
		  	}
		  }  
		  if(inputString[v] == ']'){ 
		  	depth -= 1
		  	if(depth == 0){
		  		var thisSubstring = inputString.substring(thisTermstart, v)
		  		//console.log(thisSubstring)
		  		outputArray.push(thisSubstring)
		  	}
		  }
		}
		callback((depth == 0) ? outputArray : 'error')		
	},
	getInputs: function(inputString, callback){
		//assumes it is fed a string representing a spheron array
		this.convertStringToFirstLevelArray(inputString, function(result){
			if(typeof(result) != 'string'){
				callback(result[0])
			} else {
				callback(result)
			}
		})
	},
	getBiases: function(inputString, callback){
		//assumes it is fed a string representing a spheron array
		this.convertStringToFirstLevelArray(inputString, function(result){
			if(typeof(result) != 'string'){
				callback(result[1])
			} else {
				callback(result)
			}
		})
	},
	getOutputs: function(inputString, callback){
		//assumes it is fed a string representing a spheron array
		this.convertStringToFirstLevelArray(inputString, function(result){
			if(typeof(result) != 'string'){
				callback(result[2])
			} else {
				callback(result)
			}
		})
	},
	appendInput: function(inputString, newInputData, callback){
		this.convertStringToSpheronNotation(inputString, function(thisArray){
			if(typeof(thisArray) != 'string'){
				thisArray[0] = thisArray[0] + '[' + newInputData + ']'
				var finalOut = ""
				for(var v = 0; v< thisArray.length; v++){
					finalOut += '[' + thisArray[v] + ']'
				}
				callback(finalOut)
			} else {
				callback('error')
			}
		})
	},
	appendBias: function(inputString, newBiasData, callback){
		this.convertStringToSpheronNotation(inputString, function(thisArray){
			if(typeof(thisArray) != 'string'){
				thisArray[1] = thisArray[1] + '[' + newBiasData + ']'
				var finalOut = ""
				for(var v = 0; v< thisArray.length; v++){
					finalOut += '[' + thisArray[v] + ']'
				}
				callback(finalOut)
			} else {
				callback('error')
			}
		})
	},
	appendOutput: function(inputString, newOutputData, callback){
		this.convertStringToSpheronNotation(inputString, function(thisArray){
			if(typeof(thisArray) != 'string'){
				thisArray[2] = thisArray[2] + '[' + newOutputData + ']'
				var finalOut = ""
				for(var v = 0; v< thisArray.length; v++){
					finalOut += '[' + thisArray[v] + ']'
				}
				callback(finalOut)
			} else {
				callback('error')
			}
		})
	},
	surveyAndResolveNode: function(nodeData, callback){
		//TODO:
		/*
		* Looks for completed sets of data within a node - i.e.
		* If a spheron has output variants: o1 and o2 then the paths might be [i1][b1][c1] or [i1][b1][c2] - if the test plan has 4 tests:
		* A complete set is
		* [i1][b1][o1] - t0 - [i1][b1][o2]
		* [i1][b1][o1] - t1 - [i1][b1][o2]
		* [i1][b1][o1] - t2 - [i1][b1][o2]
		* [i1][b1][o1] - t3 - [i1][b1][o2]
		*
		* => We can now look at reducting the network back to either [i1][b1][o1] - or - [i1][b1][o2]
		*
		* Further than that, this would also apply if the network is:
		*
		* [[i11][b11][o11],[i12][b12][o12]][b1][o1] versus [[i11][b11][o11],[i12][b12][o12]][b1][o2]
		*
		* i.e. nested hierachical decisions...
		*
		* If we do reduce the network then we must:
		*
		* 1) Remove the dead path
		* 2) Clear the signalTrace data across the surviving node
		*
		* Note: If we receive back propped data for a node that no-longer exists then we should simply ignore it? (Perhaps as an enhancement, this gives us more clues)
		*
		* QQ: We can only consider neural efficincy in scenarios where mutation either adds or removes a spheron.
		*
		*/
	}
}

module.exports = traceUtils