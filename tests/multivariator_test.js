var multivariator = require('../multivariator.js')

multivariator.multivariate([[12,22,33],[33,44,55],[99,89,78]], function(result){
	for(v=0;v<result.length;v++){
	console.log(result[v])	
	}
})