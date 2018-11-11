$().ready(function(){
	console.log('jQuery is ready...')
})

var msgCount=0
jQuery(document).ready(function() {
	var socket = io.connect();
	var form = jQuery('#myForm');
	var txt = jQuery('#txt');
	var diagnosticArea = jQuery('#diagnosticArea');

	socket.on('new message', function(data){
		msgCount += 1
		if(msgCount > 100){ diagnosticArea.children().last().remove() }
			var thisItem = document.createElement("div");
		thisItem.className = "well"
		thisItem.appendChild( document.createTextNode(JSON.stringify(data.message)) )
		diagnosticArea.prepend(thisItem)
    });
});