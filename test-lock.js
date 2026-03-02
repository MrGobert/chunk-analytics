const fetch = require('node-fetch');

async function run() {
  const urls = [
    'http://localhost:3000/api/metrics/notes?range=30d',
    'http://localhost:3000/api/metrics/overview?range=30d',
    'http://localhost:3000/api/metrics/acquisition?range=30d'
  ];
  
  const results = await Promise.all(urls.map(u => fetch(u).then(r => r.json())));
  console.log(JSON.stringify(results).substring(0, 500));
}

run();
