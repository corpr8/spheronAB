"use strict";

var traceUtils = require('../traceUtils.js')

//in the form functionName, operator1, operator2, expectedOUtput
var traceUtilsTestDef = [
	['getInputs', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2][output3]]', null, '[input1][input2][input3]'],
	['getBiases', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2][output3]]', null, '[bias1][bias2]'],
	['getOutputs', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2][output3]]', null, '[output1][output2][output3]'],
	['getInputs', '[[input1][input2][input3]][[bias1][bias2][[output1][output2][output3]]', null, 'error'],
	['getBiases', '[[input1][input2][input3]][[bias1][bias2]][output1][output2][output3]]', null, 'error'],
	['getOutputs', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2]output3]]', null, 'error'],
	['appendInput', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2][output3]]','newElem', '[[input1][input2][input3][newElem]][[bias1][bias2]][[output1][output2][output3]]'],
	['appendBias', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2][output3]]','newElem', '[[input1][input2][input3]][[bias1][bias2][newElem]][[output1][output2][output3]]'],
	['appendOutput', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2][output3]]','newElem', '[[input1][input2][input3]][[bias1][bias2]][[output1][output2][output3][newElem]]']
]

var failedTests = 0
var passedTests = 0

var runTests = function(idx, callback){
	idx = (idx) ? idx : 0
	if(idx < traceUtilsTestDef.length){
		var thisTest = traceUtilsTestDef[idx]
		if(thisTest[2] == null){
			//single input test
			traceUtils[thisTest[0]](thisTest[1], function(result){
				console.log('idx: ' + idx + ' expected: ' + thisTest[3] + ' got: ' + result)
				if(result == thisTest[3]){
					passedTests +=1
				} else {
					failedTests += 1
				}
				idx += 1
				runTests(idx, callback)
			})
		} else {
			//dual input test
			traceUtils[thisTest[0]](thisTest[1],thisTest[2], function(result){
				console.log('idx: ' + idx + ' expected: ' + thisTest[3] + ' got: ' + result)
				if(result == thisTest[3]){
					passedTests +=1
				} else {
					failedTests += 1
				}
				idx += 1
				runTests(idx, callback)
			})
		}
	} else {
		callback()
	}
}

runTests(0,function(){
	console.log(failedTests + ' failed, ' + passedTests + ' passed...')
})