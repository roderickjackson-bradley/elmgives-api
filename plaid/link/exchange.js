/*
 * Handle Plaid Link exchange public token
 */
/* jshint camelcase: false */

 'use strict';

const Bank = require('../../banks/bank');
const logger = require('../../logger');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class PlaidLinkExchanger {
    constructor() {
        this.middleware = exchagePlaidPublicToken.bind(this);
        this.exchangePublicToken = exchangePublicToken.bind(this);
        this.createStripeCustomer = createStripeCustomer.bind(this);
    }
}

function exchagePlaidPublicToken(request, response, next) {
    let publicToken = request.body.public_token;
    let accountID = request.body.account_id;
    let institution = request.body.institution;
    let error = new Error();
    let data = {};

    if (!publicToken) {
        error.status = 400;
        error.message = 'Missing public_token';
        return next(error);
    }
    if (!institution) {
        error.status = 400;
        error.message = 'Missing institution type';
        return next(error);
    }

    return Bank.findOne({type: institution})
        .then(bank => {
            if (!bank) {
                error.status = 400;
                error.message = 'Invalid institution type';
                return next(error);
            }
            return this.exchangePublicToken(request.plaid, institution, publicToken, accountID);
        })
        .then(exchanged => {
            let query = {};
            query['plaid.tokens.connect.' + institution] = exchanged.plaidAccessToken;
            data.access_token = exchanged.plaidAccessToken;
            return createStripeCustomer(request.currentUser, exchanged.stripeBankAccountToken)
                .then(customer => {
                    query['stripe.customer.id'] = customer.id;
                    return query;
                })
                .catch(error => {
                    logger.error(error);
                    // Try creating Stripe customer later. Meanwhile, store the token.
                    // PENDING: Queue retry message
                    query['stripe.token'] = exchanged.stripeBankAccountToken;
                    return query;
                });
        })
        .then(query => {
            request.currentUser.update(query)
                .then(() => {
                    response.json({
                        data: data
                    });
                })
                .catch(next);
        })
        .catch(next);
}

/**
 * @this Plaid - Plaid client instance
 * @param  {string} institution
 * @param  {string} publicToken
 * @param  {string} accountID
 * @return {Promise}
 */
function exchangePublicToken(plaid, institution, publicToken, accountID) {
    let error = new Error();

    return new Promise((resolve, reject) => {
        plaid.client.exchangeToken(publicToken, accountID, (err, res) => {
            if (err) {
                error.status = err.statusCode || 400;
                error.message = err.message || err.resolve;
                return reject(error);
            }

            let plaidAccessToken = res.access_token;
            let stripeBankAccountToken = res.stripe_bank_account_token;

            if (!plaidAccessToken) {
                error.status = 422;
                error.message = 'Access token could not be retrieved';
                return reject(error);
            }
            if (!stripeBankAccountToken) {
                error.status = 422;
                error.message = 'Stripe token could not be retrieved';
                return reject(error);
            }

            resolve({
                plaidAccessToken: plaidAccessToken,
                stripeBankAccountToken: stripeBankAccountToken
            });
        });
    });
}

function createStripeCustomer(user, stripeBankAccountToken) {
    return stripe.customers.create({
        email: user.email,
        description: user.name,
        source: stripeBankAccountToken
    })
    .then(customer => {
        if (!(customer.sources.data instanceof Array) || customer.sources.data.length === 0) {
            let error = new Error();
            error.status = 422;
            error.message = 'Could not create Stripe customer with the obtained Stripe token.';
            return Promise.reject(error);
        }
        return customer;
    });
}

module.exports = new PlaidLinkExchanger();
