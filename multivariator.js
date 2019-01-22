/*
* All combinations from each array exclusively (i.e. 1 from each array is excluded at any given time)
*
* Feed it an array of arrys of exclusive variants:
*
* [
*	[12,23,34],
*	[21,32,43],
*	[212,323,434]
* ]
*
* It will return an array of arrays which define what to exclude from each test.
*
* i.e. in the above, the first exclusion would be: [12,23],[21,32],[212,323] as we only want to test 34, 21 and 212 at the same time
* We can then use this in the spheron main code to update the exclusion maps for each spheron activation....
* node ./tests/multivariator_test.js
*
*/

var multivariator = {
	finalOutput: [],
	MapIterator:function(thisMaps, thisMapIdxArray, callback){
		var that = this
		if(!thisMapIdxArray){
			thisMapIdxArray = []
			for(var v=0;v<thisMaps.length;v++){
				thisMapIdxArray.push(0)
			}
		}

		that.MapPointerIterator(thisMaps, thisMapIdxArray, 1, function(){
			callback()
		})
	},
	MapPointerIterator: function(thisMaps, thisMapIdxArray, MapIdxArrayPointer, callback){
		var that = this
		if(thisMapIdxArray[0] < thisMaps[0].length){
			multivariator.buildExcludedArrays(thisMaps, thisMapIdxArray, function(ourResultantArray){
				that.finalOutput.push(ourResultantArray)
				thisMapIdxArray[0] += 1
				that.MapPointerIterator(thisMaps, thisMapIdxArray, MapIdxArrayPointer, callback)
			})

			
		} else {
			if(MapIdxArrayPointer < thisMaps.length){
				thisMapIdxArray[MapIdxArrayPointer] += 1
				if(thisMapIdxArray[MapIdxArrayPointer] > thisMaps[MapIdxArrayPointer].length-1){
					thisMapIdxArray[MapIdxArrayPointer] = 0
					MapIdxArrayPointer += 1
					that.MapPointerIterator(thisMaps, thisMapIdxArray, MapIdxArrayPointer, callback)
				} else {
					MapIdxArrayPointer = 1
					thisMapIdxArray[0] = 0
					that.MapPointerIterator(thisMaps, thisMapIdxArray, MapIdxArrayPointer, callback)
				}
			} else {
				callback()
			}
		}
	},
	buildExcludedArrays: function(thisMaps, sourceArrays, callback){
		var that = this
		that._buildExcludedArraysIterator(thisMaps, sourceArrays, 0, [], function(resultantArrays){
			callback(resultantArrays)
		})
	},
	_buildExcludedArraysIterator: function(thisMaps, sourceArrays, sourceArraysIdx, resultantArray, callback){
		var that = this
		resultantArray = (resultantArray) ? resultantArray : []
		if(sourceArrays[sourceArraysIdx] != null){
			//console.log(sourceArrays[sourceArraysIdx])

			that.excludeFromArray(thisMaps[sourceArraysIdx], sourceArrays[sourceArraysIdx], function(superArrayResult){
				resultantArray.push(superArrayResult)
				that._buildExcludedArraysIterator(thisMaps, sourceArrays, sourceArraysIdx +1, resultantArray, callback)
			})
		} else {
			callback(resultantArray)
		}
	},
	excludeFromArray: function(sourceArray, excludeIdx, callback){
		var that = this
		that._excludeFromArrayIterator(sourceArray, [], 0, excludeIdx, function(resultantArray){
			callback(resultantArray)
		})
	},
	_excludeFromArrayIterator: function(sourceArray, resultantArray, sourceArrayIdx, excludedIdx, callback){
		var that = this
		sourceArrayIdx = (sourceArrayIdx) ? sourceArrayIdx : 0
		resultantArray = (resultantArray) ? resultantArray : []

		if(sourceArray[sourceArrayIdx]){
			if(sourceArrayIdx != excludedIdx){
				resultantArray.push(sourceArray[sourceArrayIdx])
			}
			process.nextTick(function(){
				that._excludeFromArrayIterator(sourceArray, resultantArray, sourceArrayIdx +1, excludedIdx, callback)	
			})
			
		} else {
			callback(resultantArray)
		}
	},
	multivariate: function(sourceVariantArrays, callback){
		var that = this
		that.finalOutput = []
		multivariator.MapIterator(sourceVariantArrays, null, function(){
			callback(that.finalOutput)
		})		
	},
	isVariated: function(path, variantMaps, callback){
		var that = this
		if(path.substring(-1) != ';'){
			path += ';'
		}
		that.isVariatedIterator(path, variantMaps, 0, 0, function(result){
			callback(result)
		})
	},
	isVariatedIterator: function(path, variantMaps, variantMapIdx, variantMapIdxItemIdx, callback){
		console.log('in multivariator')
		//note: will currentlhy only pull back the first iterant.
		if(variantMaps[variantMapIdx]){
			if(variantMaps[variantMapIdx][variantMapIdxItemIdx]){
				console.log('searching for: ' + variantMaps[variantMapIdx][variantMapIdxItemIdx])
				if(path.substring(variantMaps[variantMapIdx][variantMapIdxItemIdx]) != -1){
					callback({map: variantMaps[variantMapIdx], id: variantMaps[variantMapIdx][variantMapIdxItemIdx]})
				} else {
					isVariatedIterator(path, variantMaps, variantMapIdx, variantMapIdxItemIdx +1, callback)
				}
			} else {
				isVariatedIterator(path, variantMaps, variantMapIdx +1, 0, callback)
			}
		} else {
			callback(false)
		}
	}
}

module.exports = multivariator



