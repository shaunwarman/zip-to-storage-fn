const fs = require('fs');
const os = require('os');
const path = require('path');
const unzip = require('unzipper');
const uuidv4 = require('uuid/v4');
const Busboy = require('busboy');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

const { BUCKET_NAME } = process.env;

const upload = async (uploadPath, filePath) => {
  console.log(`upload ${filePath} to ${uploadPath}`);
  return await storage.bucket(BUCKET_NAME || 'cdn-serv-test').upload(filePath, {
    destination: uploadPath
  });
};

exports.fileUpload = (req, res) => {
  if (req.method === 'POST') {
      const busboy = new Busboy({ headers: req.headers });
      const id = uuidv4();
      const tmpPath = path.join(os.tmpdir(), id);
      
      const uploads = {};
      let zipPath = '';
      
      // Create the directory where uploaded files will be extracted
      fs.mkdirSync(tmpPath);

      busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
          console.log(
            `File [${fieldname}] filename: ${filename}, encoding: ${encoding}, mimetype: ${mimetype}`
          );
          // Note that os.tmpdir() is an in-memory file system, so should only 
          // be used for files small enough to fit in memory.
          const filepath = path.join(tmpPath, fieldname);
          zipPath = filepath;
          file.pipe(fs.createWriteStream(filepath));
      });
      
      busboy.on('error', err => {
        console.log('busboy error', err);
      })

      busboy.on('finish', () => {
        let error = false;
        if (zipPath) {
          fs.createReadStream(zipPath)
          .pipe(unzip.Parse())
          .on('entry', (entry) => {
            const fileName = entry.path;
            const type = entry.type; // 'Directory' or 'File'
            const size = entry.size;
            const wPath = path.join(tmpPath, fileName);
            
            if (type === 'Directory') {
              fs.mkdirSync(wPath);
            }
            
            if (type === 'File') {
              uploads[fileName] = wPath;
              entry.pipe(fs.createWriteStream(wPath));
            }
          })
          .on('error', err => {
            console.log('Error during unzip', err);
            error = true;
          })
          .on('finish', async () => {
            const success = error ? false : true;
            const status = error ? 500 : 200;
            const message = error ? 'Error uploading files' : 'Successfully uploaded file(s)';
            
            const uploadList = [];
            for (const file in uploads) {
              const promise = upload(file, uploads[file]);
              uploadList.push(promise);
            }
            
            try {
              await Promise.all(uploadList);
              res.status(status).send({
                success,
                message
              });
            } catch (err) {
              res.status(status).send({
                success: false,
                message: 'Error uploading content'
              });
            }
            return;
          });
        }
      });

      // The raw bytes of the upload will be in req.rawBody.  Send it to busboy, and get
      // a callback when it's finished. This is a workaround for cloud function middleware
      // altering req.body directly, making multipart hard to parse
      // req.pipe(busboy)
      busboy.end(req.rawBody);
  } else {
      // Client error - only support POST
      res.status(405).send({
        success: false,
        message: 'Method not allowed'
      })
  }
};