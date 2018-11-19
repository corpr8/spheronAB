$().ready(function(){
	console.log('jQuery is ready. Setting up the rest of the app.')

	var socket = io.connect();
	var form = jQuery('#myForm');
	var txt = jQuery('#txt');
	var diagnosticArea = jQuery('#diagnosticArea');

	dropDb = function(){
		$.get('dropDb', function(data){
			alert('db dropped')
		})
	}
	
	submitProblem = function(){
		var thisData = $('#jobData').val()
		alert(thisData)
		$.post( "loadProblem", {jobData: thisData}, function(data){
			appendToDiagnostics("Problem submitted to spheron network...")	
		});
	}

	socket.on('new message', function(data){
		msgCount += 1
		if(msgCount > 100){ diagnosticArea.children().last().remove() }
		appendToDiagnostics(JSON.stringify(data.message))
    })
})

var msgCount=0

appendToDiagnostics = function(thisMessage){
	var thisItem = document.createElement("div");
	thisItem.className = "well"
	thisItem.appendChild( document.createTextNode(thisMessage) )
	diagnosticArea.prepend(thisItem)
}