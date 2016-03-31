/**
 * Generic module to find list of models based on model param
 */
'use strict';

const User = require('./user');
const defaultQuery = {
    archived: false
};

module.exports = function list(request, response, next) {
    return User
        .find(defaultQuery)
        .then(users => {
            let data = users.map(user => {
                return {
                    _id: user._id,
                    name: user.name,
                    email: user.email
                };
            });

            return response.json({
                data: data,
                metadata: {
                    count: users.length
                }
            });
        })
        .catch(next);
};