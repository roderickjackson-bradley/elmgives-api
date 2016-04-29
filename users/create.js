/**
 * Middleware to create user accounts
 */
'use strict';

const User = require('./user');
const email = require('../email/mandrill');
const CLIENT_URL = process.env.CLIENT_URL;
const TEMPLATE = process.env.MANDRILL_VERIFY_ACCOUNT_EMAIL_TEMPLATE;
const validateAccount = require('./validateAccount');

const logger = require('../logger');

module.exports = function create(request, response, next) {
    if (request.body.verificationToken) {
        return validateAccount(request, response, next);
    }

    return new User(request.body)
        .save()
        .then(user => {
            request.userData = user;
            let to = [{
                email: user.email
            }];

            let options = [{
                name: 'link',
                content: `${CLIENT_URL}${user.verificationToken}`
            }];

            return email.send(TEMPLATE, to, options);
        })
        .then((sent) => {
            logger.info({
                verificationEmail: sent
            });
            /**
             * There's nothing defined ( yet ) to do with sent email id
             */
            let result = {
                data: {
                    name: request.userData.name,
                    _id: request.userData._id,
                    firstName: request.userData.firstName,
                    lastName: request.userData.lastName,
                    email: request.userData.email,
                    verified: request.userData.verified
                }
            };
            response.json(result);
        })
        .catch(next);
};
