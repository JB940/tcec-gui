var _ = require('lodash');
var fs = require('fs');

function readJSON()
{
   let gameJson = 'use.json';
   const jsonMenuData = fs.readFileSync(gameJson, "utf-8");
   var data = JSON.parse(jsonMenuData);

   return (data);
}

function getDataJson()
{
   var liveJson = readJSON();
   var dataJson = {};
   var dataJSONArray = [];

   _.each(liveJson.moves, function(value, key) {
      dataJson = value;
      dataJson.engine = liveJson.engine;
      dataJSONArray[value.ply] = dataJson;
      console.log ("PV is :" + value.pv + " , for ply:" + value.ply);
      });

   for (let i = 0 ; i < dataJSONArray.length; i++)
   {
      if (dataJSONArray[i] != undefined)
      {
         console.log ("PPV is :" + JSON.stringify(dataJSONArray[i]));
      }
   }
}

getDataJson();
