/**
 * Retrieves the transaction history of a pledge
 */
'use strict';

const Npo = require('../npos/npo');
const Transaction = require('../transactions/chain/transaction');
const arraySort = require('../helpers/arraySort');
const objectId = require('mongoose').Types.ObjectId;

module.exports = function getPledgeTransactionHistory(request, response, next) {
    let all = request.query.all;
    let user = request.currentUser;
    let userID = request.params.id;
    let pledgeID = request.params.pledgeId;
    let pledge = user.pledges.find(pledge => String(pledge._id) === pledgeID);
    let error = new Error();
    let npo;

    if (String(request.session.userId) !== userID) {
        error.status = 401;
        error.message = 'unauthorized-user';
        return next(error);
    }
    if (!pledge) {
        error.status = 404;
        error.message = 'pledge-not-found';
        return next(error);
    }

    /* Retrieve the transactions of (each/all of) the pledge addresses */
    let dates = Object.keys(pledge.addresses || {}).sort().reverse();
    let addresses = dates.map(date => pledge.addresses[date]).slice(0, all ? undefined : 1);
    let promises = addresses.map(address => {
        return Transaction.find({'payload.address': address})
            .then(transactions => {
                return transactions.map(transaction => transaction.payload);
            });
    });

    Npo.findOne({_id: objectId(pledge.npoId)})
        .then(_npo => {
            npo = _npo;
            return Promise.all(promises);
        })
        .then(transactions => {
            /* Group all transactions in one array regardless of their address */
            if (transactions.length) {
                transactions = transactions.reduce((txs1, txs2) => txs1.concat(txs2));
                transactions.sort(arraySort('timestamp', request.query.newestFirst));
            }
            response.json({
                data: {
                    id: npo._id,
                    logo: npo.logoUrl,
                    transactions
                },
                meta: {
                    count: transactions.length
                }
            });
        });
};
