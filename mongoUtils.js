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
		MongoClient.connect(url, function(err, thisDb) {
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
	createSpheron: function(spheronName, model, callback){
		/*
		model = (!!model) ? model : {
			io: {
				input1: {type: "input", angle: 0, val: 0},
				rst: {type: "input", angle: 0, val: 0},
				bias: {type: "bias", angle: 180, val: 1},
				Out1: {type: "output", angle: 45, val: 0}
			}
		};

		model.type = "spheron"
		model.spheronId = (model.spheronId) ? model.spheronId : generateUUID()
		model.name = (spheronName) ? spheronName : "testSpheron"
		model.state = (model.state) ? model.state : "idle"
		model.stateTickStamp = (model.stateTickStamp) ? model.stateTickStamp : 0

		console.log('creating spheron')

		mongoNet.insertOne(model, function(err, res) {
			if (err) throw err;

			//return the new spheron id.
			callback(model.spheronId)
		});
		*/
	},
	createConnection: function(model, callback){

	},
	getSpheron: function(spheronId, callback){
		mongoNet.findOne({
			type: "spheron",
			spheronId: spheronId
		}, function(err, result) {
	    	if (err) throw err;
	    	callback(result)
		});
	},
	deleteSpheron: function(spheronId, callback){
		/*
		* TODO: We should make sure that deleting a spheron is safe - i.e. there are no connection objects pointing at or from it.
		*/
		try {
			mongoNet.deleteOne( { type: "spheron", spheronId : spheronId } );
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
			thisSpheron.problemId = problemDescription.id
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
				callback(doc)
			}	
		})
	},
	incrementTick: function(callback){
		mongoNet.findAndModify(
		    {tick: "tock"},
		    	[],
		    { 
		    	$inc: { "globalTick" :1 } },
		    {
		    	new: true,
		    	upsert: true
			}
		    , function(err,res){
			if(err){ 
				throw err
			} else {
				callback(res.value.globalTick)
			}
		})
	},
	getTick: function(callback){
		mongoNet.findOne(
		    {tick: "tock"}, 
		function(err,res){
			if(err){ 
				throw err
			} else {
				console.log(JSON.stringify(res))
				callback(res.globalTick)
			}
		})
	},
	importProblem: function(targetSpheronetJSON, callback){
		//Load a network from json into mongodb
		
	},
	_mutationOperators: {
		/*
		* 
		*/
	}
}

module.exports = mongoUtils;
