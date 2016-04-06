/**
 * Middleware to upload images to parse multipart form and upload them to S3
 */
'use strict';

const formidable = require('formidable');
const upload = require('./upload');

function parseForm(request, response, next) {
    var form = new formidable.IncomingForm();
    form.promises = [];

    form.multiples = true;
    form.maxFields = 2;
    form.keepExtensions = true;
    form.uploadDir = '/tmp';

    form.on('error', (error) => {
        return next(error);
    });

    form.on('aborted', (error) => {
        return next(error);
    });

    form.on('end', () => {
        Promise
            .all(form.promises)
            .then(done => {
                return response.json({
                    data: done
                });
            }, error => {
                return next(error);
            });
    });

    form.onPart = function(part) {

        if (!part.filename) {
            // Handle non file parts
            return this.handlePart(part);
        }

        form.promises.push(upload(part));
    };

    form.parse(request);
}

module.exports = parseForm;
