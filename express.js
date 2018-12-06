const { fileUpload } = require('./');
const Express = require('express');

const app = Express();

app.post('/upload', fileUpload);

app.listen(8000);