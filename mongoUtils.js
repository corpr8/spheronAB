var generateUUID = require('./generateUUID.js');
var mongo = require('mongodb');
var fs = require('fs');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectID;
var url = "mongodb://192.168.61.1:27017/";
var db = [];
var dbo = [];
var mongoNet = [];

/*
* A way to persist Spherons and connections out to mongo
*/ 

var mongoUtils = {
	init: function(callback){
		MongoClient.connect(url, { useNewUrlParser: true }, function(err, thisDb) {
			db = thisDb
			if (err) throw err;
			dbo = db.db("myBrain");
			mongoNet = dbo.collection("brain")
			console.log('Connected to Mongo')
			callback()
		});
	},
	closeDb: function(){
		db.close()
		return
	},
	initTick:function(callback){
		mongoNet.insertOne({
			tick:"tock",
			globalTick: 0
		}, function(err,res){	
			if(err){ 
				throw err
			} else { 
				console.log('inserted tick')
				callback()
			}
		})		
	},
	dropDb: function(callback){
		mongoNet.drop()
		console.log('dropped old database')
		callback()
	},
	find: function(callback){
		mongoNet.find({}).toArray(function(err, result) {
	    	if (err) throw err;
	    	callback(result)
		});
	}, 
	getSpheron: function(id, callback){
		mongoNet.findOne({
			type: "spheron",
			spheronId: id
		}, function(err, result) {
	    	if (err) throw err;
	    	callback(result)
		});
	},
	getLessonModeById: function(lessonId, callback){
		mongoNet.findOne({
			type: "lesson",
			problemId: lessonId
		}, function(err, result) {
	    	if (err){
	    		callback();
	    	} else {	
	    		callback(result.options.mode)
	    	}
		});
	},
	getLessonTestAnswer: function(lessonId, testIdx, callback){
		mongoNet.findOne({
			type: "lesson",
			problemId: lessonId
		}, function(err, results) {
	    	if (err){
	    		callback();
	    	} else {	
	    		callback(results.tests[testIdx].outputs)
	    	}
		});
	},
	getLessonLength: function(lessonId, callback){
		mongoNet.findOne({
			type: "lesson",
			problemId: lessonId
		}, function(err, results) {
	    	if (err){
	    		callback();
	    	} else {	
	    		callback(results.tests.length)
	    	}
		});
	},
	assessIfLessonPassed(problemId, lowestFound, callback){
		mongoNet.findOne({
			type: "lesson",
			problemId: lessonId
		}, function(err, results) {
	    	if (err){
	    		callback();
	    	} else {	
	    		if(lowestFound < results.options.errorThreshold){
					mongoNet.findOneAndUpdate({
						type: "lesson",
						problemId: lessonId
					},{
						$set: {mode:"trained"}
					}, 
					{}, 
					function(err,doc){
						if(err){
							callback()
						} else { 
							callback('trained')
						}	
					})
	    		} else {
	    			callback()
	    		}
	    	}
		});
	},
	_old_saveSpheron: function(spheronData, callback){
		console.log('saving spheron')
		console.log('new data: ' + JSON.stringify(spheronData))
		mongoNet.updateOne({"spheronId" : spheronData.spheronId}, spheronData, function(err, result){
			callback()
		})
	},
	deleteSpheron: function(id, callback){
		/*
		* TODO: We should make sure that deleting a spheron is safe - i.e. there are no connection objects pointing at or from it.
		*/
		try {
			mongoNet.deleteOne({
				type: "spheron", 
				id : id 
			});
			callback()
		} catch (e) {
			console.log('bad delete: ' + e)
			throw(e);
		}
	},
	deleteConnection: function(connectionId, callback){
		/*
		* 
		*/
	},
	dropCollection: function(callback){
		mongoNet.drop()
		console.log('Collection dropped')
		callback()
	},
	setupDemoData: function(demoData, callback){
		var that = this
		this.dropCollection(function(){
			//now import this spheron data into the db
			//console.log(JSON.stringify(demoData))
			//now iterate the data and load it...
			that.createProblemDefinition(demoData, function(){
				that.createSpheronFromArrayIterator(0, demoData, function(){
					console.log('sample spherons created.')
					callback()
				})	
			})
		})
	},
	importProblem: function(problemDefinition, callback){
		/*
 		* Create Job Metadata db entry - (including testplan)
    	* Create initial Spheron network
    	* Load test plan onto activation spherons input queues - with a time based spread...
		*/
		var that = this
		that.createProblemDefinition(problemDefinition, function(){
			that.createSpheronFromArrayIterator(0, problemDefinition, function(){
				console.log('Problem imported, spheron array created.')
				callback()
			})
		})
	},
	createProblemDefinition: function(demoData, callback){
		var thisProblemDefinition = JSON.parse(JSON.stringify(demoData))
		//delete thisProblemDefinition.network
		mongoNet.insertOne(thisProblemDefinition, function(err, res) {
			if (err) throw err;
			callback()
		});
	},
	createSpheronFromArrayIterator: function(idx, problemDescription, callback){
		var that = this
		if(idx < (problemDescription.network).length){
			//console.log(JSON.stringify(problemDescription.network[idx]))
			var thisSpheron = problemDescription.network[idx]
			thisSpheron.problemId = problemDescription.problemId
			mongoNet.insertOne(thisSpheron, function(err, res) {
				if (err) throw err;
				idx += 1
				that.createSpheronFromArrayIterator(idx, problemDescription, callback)
			});
		} else {
			callback()
		}
	},
	getNextPendingSpheron: function(tickStamp, callback){
		//The main function loop - pulls back spherons which are awaitng processing.
		//TODO: Works but needs to return the one with the lowest pendAct + state == pending
		console.log('getting next spheron for tick: ' + tickStamp)
		//nextTick: { $lt: thisNextTick },
					//
		mongoNet.findOneAndUpdate({
			nextTick: { $lte: tickStamp },
			type:"spheron",
			state:"pending"
		},{
			$set:{state:"running"}
		}, {
			new: true,
			sort: {nextTick: -1}
		}, function(err,doc){
			if(err){
				console.log('no pending spherons')
				callback({})
			} else if (doc.value != null){ 
				console.log('spheron is: ' + JSON.stringify(doc.value))
				callback(doc.value)
			} else {
				console.log('spheron was null: ' + JSON.stringify(doc))
				callback({})
			}
		})
	},
	persistSpheron: function(spheronId, updateJSON, callback){
		console.log('about to persist spheron: ' + spheronId)
		console.log('update JSON is: ' + JSON.stringify(updateJSON))
		mongoNet.findOneAndUpdate({
			spheronId: spheronId
		},{
			$set: updateJSON
		}, 
		{}, 
		function(err,doc){
			if(err){
				callback({})
			} else { 
				callback()
			}	
		})
	},
	_mutationOperators: {
		/*
		* 1: clone + tweak connection (in new or existent A/B group)
		* 2: add connection to random existent spheron (in new or existent A/B)
		* 3: add connection to new spheron (in new A/B)
		* 4: remove connection (in new or existent A/B group)
		* 5: remove spheron? Or is this a function of a spheron not having any outputs - or not being in an audit path - for any A/B tests for this problemId???
		*/
	}
}

module.exports = mongoUtils;
