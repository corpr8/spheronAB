"use strict";
const fs = require('fs');

var logger = function(logOptions){
	var that = this
	that.logOptions = logOptions
	that.wStream = fs.createWriteStream(logOptions.logPath, { encoding: 'ascii' });

	that.wStream.on('error', function(e){
		throw('logger error: ' + e)
	})
}

logger.prototype.log = function(moduleName, logOption, logMsg){
	var that = this
	logMsg = (logMsg) ? logMsg.toString() : ''
	if((typeof(logOption) == 'number' && logOption <= that.logOptions.logLevel) || (logOption == 'extOutput' && that.logOptions.logExtOutputEvents == true)){

	var d = new Date()
	var datetext = (d.toTimeString()).split(' ')[0]


		that.wStream.write(datetext + ' : ' + moduleName + ' : ' + logMsg + '\n')
	}
}

logger.prototype.exit = function(callback){
	var that = this
	that.wStream.close()
	callback()
}

module.exports = logger;
