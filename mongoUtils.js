var generateUUID = require('./generateUUID.js');
var mongo = require('mongodb');
var fs = require('fs');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectID;
var url = "mongodb://localhost:27017/";
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
		return
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
			id: id
		}, function(err, result) {
	    	if (err) throw err;
	    	callback(result)
		});
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
	createProblemDefinition: function(demoData, callback){
		var thisProblemDefinition = JSON.parse(JSON.stringify(demoData))
		delete thisProblemDefinition.network
		mongoNet.insertOne(thisProblemDefinition, function(err, res) {
			if (err) throw err;
			callback()
		});
	},
	createSpheronFromArrayIterator: function(idx, problemDescription, callback){
		var that = this
		if(idx < (problemDescription.network).length){
			console.log(JSON.stringify(problemDescription.network[idx]))
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
	getNextPendingSpheron: function(callback){
		//The main function loop - pulls back spherons which are awaitng processing.
		//TODO: Works but needs to return the one with the lowest pendAct + state == pending
		mongoNet.findOneAndUpdate({
			type:"spheron",
			state:"pending"
		},{
			$set:{state:"running"}
		}, {
			new: true,
			sort: {stateTickStamp: -1}
		}, function(err,doc){
			if(err){
				callback({})
			} else { 
				callback(doc.value)
			}	
		})
	},
	persistSpheron: function(spheronId, updateJSON, callback){
		console.log('about to update spheron: ' + spheronId)
		var hadDocuments = false
			mongoNet.find({
				"type":"spheron",
				"spheronId" : spheronId
			}).forEach(function (doc) {
				if(doc){
					hadDocuments = true
					//console.log('in a doc: ' + JSON.stringify(doc))
					if(updateJSON.io){
						for (var port in updateJSON.io) {
						    for (var setting in updateJSON.io[port]) {
						    	//console.log(doc.io)
						    	//console.log(port)
						    	if(doc.io[port]){
							    	//console.log(doc.io[port][setting])
							    	//console.log(updateJSON.io[port][setting])
							    	doc.io[port][setting] = updateJSON.io[port][setting]
						    	}
						    }
						}
					}
					if(updateJSON.state){
						doc.state = updateJSON.state
					}
					if(updateJSON.stateTickStamp){
						doc.stateTickStamp = updateJSON.stateTickStamp
					}

					console.log('updated doc is: ' + JSON.stringify(doc))
					mongoNet.updateOne({"spheronId" : spheronId },{$set:doc}, function(doc){
						process.nextTick(function(){
							callback()	
						})
					});
				} else {
					callback()
				}					
			}).then(function(){
			if(hadDocuments == false){
				console.log('had documents:' + hadDocuments)
				console.log('weirdly we are here. Is this because of exactly 0 results???')
				callback()
			}	
			})
			
	},
	_mutationOperators: {
		/*
		* 
		*/
	}
}

module.exports = mongoUtils;
