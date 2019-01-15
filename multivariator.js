var thisMapsSample = [
	[12,23,34],
	[21,32,43],
	[212,323,434]
]

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
* i.e. in the above, the first exclusion would be: [12,23] as we only want to test 34
*
* We can then use this in the spheron main code to run fully divergent tests....
*
* Test using: v.multivariate([[12,22,33],[33,44,55],[99,89,78]], function(){console.log('all done')})
* Note: although diplayed as a single row, the data on each line is actually in the form [aa,bb],[cc,dd],[ee,ff]
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
			//console.log('done building exclusion arrays:' + resultantArrays)
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
			that._excludeFromArrayIterator(sourceArray, resultantArray, sourceArrayIdx +1, excludedIdx, callback)
		} else {
			callback(resultantArray)
		}
	},
	multivariate: function(sourceVariantArrays, callback){
		var that = this
		that.finalOutput = []
		multivariator.MapIterator(sourceVariantArrays, null, function(){
			/*
			* we should put module output here...
			*/
			console.log('length of 0th output is: ' + that.finalOutput[0].length)
			for(var v=0;v<that.finalOutput.length;v++){
				console.log('ourResultantArray['+v+'] is: ' + that.finalOutput[v])
			}
			callback()
		})		
	}
}

module.exports = multivariator



