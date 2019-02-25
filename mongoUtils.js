var moduleName = 'mongo'
var Logger = require('./logger.js')
var logger;
var settings = require('./settings.json')
var generateUUID = require('./generateUUID.js');
var mongo = require('mongodb');
var fs = require('fs');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectID;
var url = "mongodb://127.0.0.1:27017/"; //if running locally on network.
//var url = "mongodb://192.168.61.1:27017/"; //if running locally on macbook with alias set up.
var db = [];
var dbo = [];
var mongoNet = [];

/*
* A way to persist Spherons and connections out to mongo
*/ 

var mongoUtils = {
	logger,
	init: function(callback){
		var that = this
		that.logger = new Logger(settings.logOptions)
		MongoClient.connect(url, { useNewUrlParser: true }, function(err, thisDb) {
			db = thisDb
			if (err) throw err;
			dbo = db.db("myBrain");
			mongoNet = dbo.collection("brain")
			that.logger.log(4,'Connected to Mongo')
			callback()
		});
	},
	closeDb: function(){
		db.close()
		return
	},
	initTick:function(callback){
		var that = this
		mongoNet.insertOne({
			tick:"tock",
			globalTick: 0
		}, function(err,res){	
			if(err){ 
				throw err
			} else { 
				that.logger.log(4,'inserted tick')
				callback()
			}
		})		
	},
	dropDb: function(callback){
		var that = this
		mongoNet.drop()
		that.logger.log(4,'dropped old database')
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
		var that = this
		if(!lessonId) throw 'no lessonId supplied'
		if(!testIdx) throw 'no testIdx supplied'
		mongoNet.findOne({
			type: "lesson",
			problemId: lessonId
		}, function(err, results) {
	    	if (err){
	    		callback();
	    	} else {
	    		that.logger.log(3,'lesson data: ' + results.tests[testIdx])
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
			problemId: problemId
		}, function(err, results) {
	    	if (err){
	    		callback();
	    	} else {	
	    		if(lowestFound < results.options.errorThreshold){
					mongoNet.findOneAndUpdate({
						type: "lesson",
						problemId: problemId
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
		var that = this
		that.logger.log(4,'saving spheron')
		that.logger.log(5,'new data: ' + JSON.stringify(spheronData))
		mongoNet.updateOne({"spheronId" : spheronData.spheronId}, spheronData, function(err, result){
			callback()
		})
	},
	deleteSpheron: function(id, callback){
		var that = this
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
			that.logger.log(4,'bad delete: ' + e)
			throw(e);
		}
	},
	deleteConnection: function(connectionId, callback){
		/*
		* 
		*/
	},
	dropCollection: function(callback){
		var that = this
		mongoNet.drop()
		that.logger.log(4,'Collection dropped')
		callback()
	},
	setupDemoData: function(demoData, callback){
		var that = this
		this.dropCollection(function(){
			//now import this spheron data into the db
			//that.logger.log(4,JSON.stringify(demoData))
			//now iterate the data and load it...
			that.createProblemDefinition(demoData, function(){
				that.createSpheronFromArrayIterator(0, demoData, function(){
					that.logger.log(4,'sample spherons created.')
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
				that.logger.log(4,'Problem imported, spheron array created.')
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
			//that.logger.log(4,JSON.stringify(problemDescription.network[idx]))
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
		var that = this
		//The main function loop - pulls back spherons which are awaitng processing.
		//TODO: Works but needs to return the one with the lowest pendAct + state == pending
		that.logger.log(4,'getting next spheron for tick: ' + tickStamp)
		//nextTick: { $lt: thisNextTick },
					//
		mongoNet.findOneAndUpdate({
			nextTick: { $lt: tickStamp },
			type:"spheron",
			state:"pending"
		},{
			$set:{state:"running"}
		}, {
			new: true,
			sort: {nextTick: -1}
		}, function(err,doc){
			if(err){
				that.logger.log(4,'no pending spherons: ' + err)
				callback({})
			} else if (doc.value != null){ 
				that.logger.log(4,'spheron is: ' + JSON.stringify(doc.value))
				callback(doc.value)
			} else {
				that.logger.log(4,'spheron was null: ' + JSON.stringify(doc))
				callback({})
			}
		})
	},
	persistSpheron: function(spheronId, updateJSON, callback){
		var that = this
		that.logger.log(4,'about to persist spheron: ' + spheronId)
		that.logger.log(6,'update JSON is: ' + JSON.stringify(updateJSON))
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
	getTrainigData: function(problemId,callback){
		mongoNet.findOne({
			type: "lesson",
			problemId: problemId
		}, function(err, result) {
	    	if (err) throw err;
	    	callback(result.tests)
		});		
	}
}

module.exports = mongoUtils;
