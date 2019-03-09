var https = require("https");
var url = require('url');
var fs = require('fs');
var io = require('socket.io')();
var express = require('express');
var app = express();
var path = require('path');
const md5 = require('md5');
const axios = require('axios');
var chokidar = require('chokidar');
var _ = require('lodash');
var lastPgnTime = Date.now();
const Tail = require('nodejs-tail');
const pid = process.pid;
const exec = require('child_process').exec;
const argv = require('yargs').argv;
let bonus = 0;

if (argv.port == undefined)
{
   portnum = 8080;
}
else
{
   portnum = argv.port;
}

if (argv.bonus != undefined)
{
   if (isNaN(argv.bonus))
   {
      bonus = 0;
   }
   else
   {
      bonus = parseInt(argv.bonus);
   }
}
console.log ("Port is " + portnum + " ,bonus:" + bonus);

var app = express();

/* Encryption keys */
var options = 
{
   key: fs.readFileSync('/etc/letsencrypt/live/tcecbonus.club/privkey.pem'),
   cert: fs.readFileSync('/etc/letsencrypt/live/tcecbonus.club/fullchain.pem')
};

var server = https.createServer(options, app).listen(parseInt(portnum), function() 
{
   console.log('Express server listening on port ' + portnum);
});

var listener = io.listen(server);

io.attach(server, {
   pingInterval: 25000,
   pingTimeout: 5000
});

app.get('/api/gameState', function (req, res) 
{
   console.log('api gameState request');
   var currentFen = '';
   var liveData = fs.readFileSync('live.json');
   var liveJsonData = JSON.parse(liveData);

   if (liveJsonData.Moves.length > 0) 
   {
      currentFen = liveJsonData.Moves[(liveJsonData.Moves.length - 1)].fen;
   }

   var response = 
   {
      'White': liveJsonData.Headers.White,
      'Black': liveJsonData.Headers.Black,
      'CurrentPosition': currentFen,
      'Result': liveJsonData.Headers.Result,
      'Event': liveJsonData.Headers.Event
   }
   res.setHeader('Content-Type', 'application/json');
   res.status(200).send(JSON.stringify(response))
});

app.get('/api/currentPosition', function (req, res) 
{
   console.log('api currentPosition request');
   var currentFen = 'No game in progress';
   var liveData = fs.readFileSync('live.json');
   var liveJsonData = JSON.parse(liveData);

   if (liveJsonData.Moves.length > 0) {
      currentFen = liveJsonData.Moves[(liveJsonData.Moves.length - 1)].fen;
   }

   res.setHeader('Content-Type', 'application/json');
   res.status(200).send(currentFen);
});

var liveeval = 'data.json';
var livejson = 'live.json';

var watcherFast = chokidar.watch(livejson, {
   persistent: true,
   ignoreInitial: false,
   followSymlinks: true,
   disableGlobbing: false,
   usePolling: true,
   interval: 50,
   binaryInterval: 100,
   alwaysStat: false,
   depth: 3,
   atomic: 100
   });

if (!bonus)
{
   watcherFast.add('data1.json');
   watcherFast.add('liveeval.json');
   watcherFast.add('liveeval1.json');
   watcherFast.add(liveeval);
}

/* Other chokidar options */
//awaitWriteFinish: {
//stabilityThreshold: 2000,
//pollInterval: 100
//}
//atomic: true // or a custom 'atomicity delay', in milliseconds (default 100)


var ctable = 'crosstable.json';
var watcherSlow = chokidar.watch(ctable, {
   persistent: true,
   ignoreInitial: false,
   followSymlinks: true,
   disableGlobbing: false,
   usePolling: true,
   interval: 2000,
   binaryInterval: 2000,
   alwaysStat: false,
   depth: 3,
   });
watcherSlow.add('schedule.json');
watcherSlow.add('banner.txt');

var count = 0;
var socket = 0;
var totalCount = 0;
var socketArray = [];
var userCountFactor = 1.0;

function arrayRemove(arr, value) 
{
   return arr.filter(function(ele){
      return ele != value;
   });
}

function showDuplicates(names)
{
   var uniq = names
   .map((name) => {
      return {count: 1, name: name}
   })
   .reduce((a, b) => {
      a[b.name] = (a[b.name] || 0) + b.count
      return a
   }, {})

   var duplicates = Object.keys(uniq).filter((a) => uniq[a] > 1)

   console.log(duplicates);
}

function userCount()
{
   var userCountFinal = parseInt(socketArray.length);

   if (userCountFinal < totalCount)
   {
      userCountFinal = totalCount;
   }
   else if (totalCount)
   {
      userCountFinal = totalCount;
   }
   return (parseInt(userCountFinal * userCountFactor));
}

function userCountActual()
{
   return (parseInt(socketArray.length));
}

function getPGN(id, menuData)
{
   var found = 0;
   var retPgn = {};
   var data = menuData;

   _.each(data.Seasons, function(value, key) {
      if (found)
      {
         return false;
      }
      _.each(value.sub, function(subvalue,subkey) {
         if ((subvalue.id == id) ||
            (subvalue.idf == id))
         {
            retPgn.abb = subvalue.abb;
            retPgn.pgnfile = subvalue.abb + ".pgn";
            retPgn.scjson  = subvalue.abb + "_Schedule.json";
            retPgn.download = value.download;
            retPgn.url = subvalue.url;
            found = 0;
            return false;
         }
      });
   });

   return retPgn;
}

var pgnDir = '/var/www/json/archive/'
var json = '/var/www/json/archive/';
var archroot = '/var/www/cd.tcecbeta.club/';
var gameJson = archroot + 'gamelist.json';
var singlePerl = archroot + 'single.pl';
var tag = null;
var pgnFile = null;
var fullzip = 0;
var prevData = 0;
var prevliveData = 0;
var prevevalData = 0;
var prevliveData1 = 0;
var prevevalData1 = 0;
var prevCrossData = 0;
var prevSchedData = 0;
var delta = {};
var inprogress = 0;
var lineArray = [];
var lineChanged = 0;

function checkLatestArchive()
{
   const jsonMenuData = JSON.parse(fs.readFileSync(gameJson, "utf-8"));
   var retPgn = getPGN('current', jsonMenuData);
   console.log ("retPgn: " + JSON.stringify(retPgn));

   if (retPgn.found == 0)
   {
      return 0;
   }

   tag = retPgn.abb;
   pgnFile = pgnDir + retPgn.pgnfile;
   fullzip = retPgn.download;

   return (pgnFile);
}

if (!bonus && checkLatestArchive())
{
   console.log ("Adding pgnfile:" + pgnFile);
   watcherSlow.add(pgnFile);
}

io.sockets.on ('connection', function(socket)
{
   var socketId = socket.id;
   var clientIp = socket.request.connection.remoteAddress;
   count = socketArray.length;

   if (socketArray.indexOf(clientIp) === -1)
   {
      socketArray.push(clientIp);
   }

   socket.on('room', function(room) 
   {
      if (room == 'room5')
      {
         socket.join('room5');
      }
      if (room == 'room10')
      {
         socket.join('room10');
      }
      if (room == 'roomall')
      {
         socket.join('roomall');
      }
   });

   socket.on('noroom', function(room) 
   {
      socket.leave('room5');
      socket.leave('room10');
      socket.leave('roomall');
   });

   socket.on('disconnect', function()
   {
      socketArray = arrayRemove(socketArray, clientIp);
   });

   socket.on('getusers', function(data)
   {
      socket.emit('users', {'count': userCount()});
   });

   socket.on('refreshdata', function(data)
   {
      if (delta)
      {
         delta.refresh = 1;
         delta.Users = userCount();
         socket.emit('pgn', delta);
         delta.refresh = 0;
         //console.log ("Sent delta pgn data to connected socket:" + JSON.stringify(delta).length + ",changed" + clientIp + ", from serverXXXX:" + pid);
      }
      else if (prevData)
      {
         prevData.refresh = 1;
         prevData.Users = userCount();
         socket.emit('pgn', prevData);
         prevData.refresh = 0;
         //console.log ("Sent full pgn data to connected socket:" + JSON.stringify(delta).length + ",changed" + clientIp + ", from serverXXXX:" + pid);
      }
      console.log('XXXXXX: req came' + lastPgnTime);
   });

});

//var liveChartInterval = setInterval(function() { process.send({'workers': userCountActual()}) }, 30000);
function sendUsers()
{
   setTimeout(function() { broadCastUsers(); }, 5000);
}

function broadCastUsers()
{
   io.local.emit('users', {'count': userCount()});
}

function broadCastData(socket, message, file, currData, prevData)
{
   var a = JSON.stringify(currData);
   var b = JSON.stringify(prevData);

   if (a == b)
   {
      //console.log ("File "+ file + " did not change:");
      return;
   }
   io.local.emit(message, currData);
}

function checkSend(currData, prevData)
{
   var a = JSON.stringify(currData);
   var b = JSON.stringify(prevData);

   if (a == b)
   {
      //console.log ("File "+ file + " did not change:");
      return 0;
   }
   else
   {
      return 1;
   }
}

/* Deltapgn: Configure this to less value for less data */
var numMovesToSend = 4;

function getDeltaPgn(pgnX)
{
   var pgn = {};
   var countPgn = 0;
   pgnX.Users = userCount();

   if (prevData && JSON.stringify(prevData.Headers) != JSON.stringify(pgnX.Headers))
   {
      pgnX.gameChanged = 1;
      return pgnX;
   }
   pgnX.gameChanged = 0;
   
   if (pgnX && pgnX.Moves && (pgnX.Moves.length - numMovesToSend) > 0) {
      pgnX.Moves.splice(0, pgnX.Moves.length - numMovesToSend);
   }
   console.log ("Setting pgn.lastMoveLoaded to " + (pgnX.Moves[pgnX.Moves.length].key + 1));
   return pgn;
}

var liveChartInterval = setInterval(function() { sendlines(); }, 3000);

function sendArrayRoom(array, room, count)
{
   var localArray = array;
   
   if (localArray.length)
   {
      if (localArray.length - count > 0)
      {
         localArray.splice(0, localArray.length - count);
      }
      if (localArray.length)
      {
         io.sockets.in(room).emit('htmlread', {'room': room, 'data': localArray.join('\n')});
      }
   }
}

function sendlines()
{
   if (lineChanged)
   {
      var room5Array = lineArray;
      var room10Array = lineArray;

      sendArrayRoom(lineArray, 'room5', 5);
      sendArrayRoom(lineArray, 'livelog', 5);
      sendArrayRoom(lineArray, 'room10', 10);
      sendArrayRoom(lineArray, 'roomall', 1000);

      lineArray = [];
      lineChanged = 0;
   }
}

const tail = new Tail('/var/www/json/loglive/livelink.log', {
   persistent: true,
   ignoreInitial: false,
   followSymlinks: true,
   disableGlobbing: false,
   usePolling: true,
   interval: 1000,
   binaryInterval: 5000,
   alwaysStat: false,
   depth: 1
   //atomic: true // or a custom 'atomicity delay', in milliseconds (default 100)
});

tail.on('line', (line) => {
   line = line.replace(/>/g, '');
   line = line.replace(/</g, '');
   lineArray.push(line);
   lineChanged = 1;
   //console.log ("line:" + lineArray);
});

tail.watch();

if (!bonus)
{
   var makeLink = '/scratch/tcec/Commonscripts/Divlink/makelnk.sh';

   exec(makeLink + ' ' + tag, function callback(error, stdout, stderr){
      console.log ("Error is :" + stderr);
      console.log ("Output is :" + stdout);
   });
}

watcherFast.on('change', (path, stats) => 
{
   var content = fs.readFileSync(path, "utf8");
   try
   {
      var data = JSON.parse(content);
      if (path.match(/data.json/))
      {
         broadCastData(socket, 'liveeval', path, data, prevliveData);
         prevliveData = data;
      }
      if (path.match(/data1.json/))
      {
         broadCastData(socket, 'liveeval1', path, data, prevliveData1);
         prevliveData1 = data;
      }
      if (path.match(/liveeval.json/))
      {
         broadCastData(socket, 'livechart', path, data, prevevalData);
         console.log ("Sending /liveeval.json/");
         prevevalData = data;
      }
      if (path.match(/liveeval1.json/))
      {
         broadCastData(socket, 'livechart1', path, data, prevevalData1);
         prevevalData1 = data;
      }
      if (path.match(/live.json/))
      {
         //console.log ("json changed");
         var changed = checkSend(data, prevData);
         if (changed)
         {
            delta = getDeltaPgn(data, prevData);
            //broadCastData(socket, 'pgn', path, delta, delta);
            io.local.emit('pgn', delta);
            //console.log ("Sent pgn data:" + JSON.stringify(delta).length + ",orig" + JSON.stringify(data).length + ",changed" + delta.Users);
            lastPgnTime = Date.now();
         }
         prevData = data;
      }
   }
   catch (error)
   {
      console.log ("error: " + error);
      return;
   }
});

watcherFast
  .on('add', path => console.log(`File ${path} has been added`))
  .on('unlink', path => { console.log(`File ${path} has been removed`) ;
                          if (path.match(/liveeval.*/))
                          {
                             console.log ("Trying to add path:" + path);
                             setTimeout(function() { watcherFast.add(path)}, 30000);
                             setTimeout(function() { watcherFast.add(path)}, 60000);
                             setTimeout(function() { watcherFast.add(path)}, 90000);
                             setTimeout(function() { watcherFast.add(path)}, 130000);
                             watcherFast.add(path);
                          }
                        })
  .on('error', error => console.log(`Watcher error: ${error}`));

watcherSlow.on('change', (path, stats) => 
{
   console.log ("slow path changed:" + path);
   if (!bonus && (path == pgnFile))
   {
      console.log ("Need to do something about pgnfile");
      if (inprogress == 0)
      {
         inprogress = 1;
         var perlrun = "perl " + singlePerl + " --ful " + fullzip + " --tag " + tag + ' --loc ' + json + tag;
         console.log ("Need to run :" + perlrun);
         exec(perlrun, function(err, stdout, stderr) {
            console.log ("Doing it:" + stdout + stderr);
            setTimeout(function() {
               io.emit('refreshsched', {'count': 1});
            }, 15000);
            inprogress = 0;
         });
      }
      else
      {
         console.log ("Already another in progress");
      }
   }
   else
   {
      var content = fs.readFileSync(path, "utf8");
      try
      {
         var data = JSON.parse(content);
         if (path.match(/crosstable/))
         {
            broadCastData(socket, 'crosstable', path, data, prevCrossData);
            prevCrossData = data;
         }
         if (path.match(/schedule/))
         {
            broadCastData(socket, 'schedule', path, data, prevSchedData);
            prevSchedData = data;
         }
         if (path.match(/banner/))
         {
            io.local.emit('banner', data);
         }
      }
      catch (error)
      {
         console.log ("error: " + error);
         return;
      }
   }
});

process.on('message', function(msg)
{
   console.log('Worker ' + process.pid + ' received message from master.', JSON.stringify(msg));
   totalCount = parseInt(msg.count);
});
