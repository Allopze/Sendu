import fetch from 'node-fetch';

fetch('http://localhost:3000/api/settings/public')
    .then(res => res.json())
    .then(data => console.log(JSON.stringify(data, null, 2)))
    .catch(err => console.error(err));
