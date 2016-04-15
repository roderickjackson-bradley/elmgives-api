/**
 * Middleware to associate npos, banks and current user
 */
'use strict';

const Charity = require('./pledge');
const NPO = require('../npos/npo');
const Bank = require('../banks/bank');

module.exports = (request, response, next) => {
    const userId = request.body.userId + '';

    if (request.session.userId + '' !== userId) {
        return response.status(401).json({
            error: {
                message: 'user not authorized'
            }
        });
    }

    let user = request.currentUser;

    let npo = NPO.findOne({
        _id: request.body.npoId
    });

    let bank = Bank.findOne({
        _id: request.body.bankId
    });

    let exist = user.pledges.some(item => {
        return item.npoId + '' === request.body.npoId &&
            item.bankId + '' === request.body.bankId;
    });

    if (exist) {
        let error = new Error();
        error.status = 422;
        error.message = 'Charity already exist';

        return next(error);
    }

    Promise
        .all([npo, bank])
        .then(values => {
            if (!values[0] || !values[1]) {
                let error = new Error();
                error.status = 422;
                error.message = 'Proper fields values requiered';

                return next(error);
            }

            let pledge = {
                montlyLimit: request.body.montlyLimit,
                npoId: request.body.npoId,
                bankId: request.body.bankId,
                npo: values[0].name,
                bank: values[1].name,
                userId: request.session.userId
            };

            return new Charity(pledge);
        }, error => {
            return next(error);
        })
        .then(pledge => {
            user.pledges.push(pledge);
            request.pledgeId = pledge._id;
            return user.save();
        })
        .then(( /*user*/ ) => response.json({
            data: [user.pledges.id(request.pledgeId)]
        }))
        .catch(next);
};