require('newrelic');

var http = require('http');
var https = require('https');

var pushSubs = [];
var monitorSubs = [];

function onRequest(req, res) {    
    log("Request for " + req.url + " received");
	var path = req.url.split("/");

    if (path[1] == "subscribe") {
        res.writeHead(200);        
        if (path[2] && path[2].length > 10 && pushSubs.filter(function(sub) { return sub.id == path[2]; }).length == 0) {        	
        	pushSubs.push({ id : path[2], subscribed : new Date().getTime() });
        	res.write("subscribed " + path[2]);
        } else {
        	res.write("already subscribed")
        }
    } else if (path[1] == "monitor") {
		res.writeHead(200);
		if (path[2] && path[2].length > 10 && monitorSubs.indexOf(path[2]) == -1) {        	
        	monitorSubs.push(path[2]);
        	res.write("subscribed monitor " + path[2]);
        } else {
        	res.write("already monitoring")
        }
    } else if (path[1] == "recent") {
		res.writeHead(200, { "Content-Type" : "text/html"});
		res.write("<p>" + ringBuffer.join("</p><p>") + "</p>");		        
    } else {
		res.writeHead(500);
    }
    res.end();
}

var port = Number(process.env.PORT || 8000);
http.createServer(onRequest).listen(port);
console.log('Listening on port ' + port);

var YAMBA_POLL_FREQ = 30*1000; // polling frequency to Yamba
var TIMEOUT_SUB = 3600*1000; // subscriptions timeout after 1 hr
var API_KEY = process.env.GCM_API_KEY;
var YAMBA_PWD = process.env.YAMBA_PWD;
var serviceURL = "http://student:" + YAMBA_PWD + "@yamba.marakana.com/api/statuses/friends_timeline.json";
var lastYambaLatest = "";

setInterval(checkYamba, YAMBA_POLL_FREQ);

function checkYamba() {
	var res_data="";
	http.get(serviceURL, function(res) {
  		log("Got response from Yamba: " + res.statusCode);
  		res.on('data', function(chunk) {
	    	res_data += chunk;
	  	}).on('end', function() {
	  		try {
	  			var posts = JSON.parse(res_data);
	  			var latest = posts[0].created_at;
	  			if (latest != lastYambaLatest) {
	  				notifySubscribers(latest);
	  				lastYambaLatest = latest;
	  			}
	  			log("Got " + posts.length + " posts");
	  		} catch (e) {
	  			notifyMonitors(e);
	  		}	    	
	    }).on('error', function(e) {
	    	log("Got error on resp from Yamba: " + e.message);	
	    	notifyMonitors(e);
	    });
	}).on('error', function(e) {
  		log("Got error on req to Yamba: " + e.message);
  		notifyMonitors(e);
	});
}

function notifySubscribers(lastPostTime) {
	log("OK New Last Yamba post " + lastPostTime);
	var now = new Date().getTime();
	pushSubs = pushSubs.filter(function(sub) {
		return (now - sub.subscribed) < TIMEOUT_SUB;
	});
	gcm(pushSubs.map(function(sub) { return sub.id; }), lastPostTime);
}

function notifyMonitors(err) {
	var jsonString = JSON.stringify(err);
	log("ERROR on Yamba " + jsonString);	
	gcm(monitorSubs, jsonString);
}

function gcm(receivers, data) {
	var opts = {
	    hostname: 'android.googleapis.com',
	    port: 443,
	    method: 'POST',
	    path: '/gcm/send',
	    headers: { 
	    	"Authorization" : "key=" + API_KEY,
	    	"Content-Type" : "application/json" }
	};	

	opts.headers['Content-Type'] = 'application/json';
	var postData = JSON.stringify({
		registration_ids : receivers,
		data : {
			message : data
		}
	});
	opts.headers['Content-Length'] = postData.length;
	
	var res_data = "";

	var req = https.request(opts, function(response) {
		log("GCM response status: " + response.statusCode); 
		response.on('data', function(chunk) {
	    	res_data += chunk;
		}).on('end', function() {
	    	log("GCM response: " + res_data);
		});
	});

	req.on('error', function(e) {
		log("Got error in gcm POST comms: " + e.message);
	});

	if (opts.method != 'GET') {
		log("Sending to GCM: " + postData);
		req.write(postData);
	}

	req.end();
}

var ringBuffer = Array(20);

function log(str) {
	str = new Date().toString() + ":" + str;
	ringBuffer.push(str);
	ringBuffer.shift();
	console.log(str);
}