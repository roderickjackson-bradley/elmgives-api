/*
 * Handle Plaid Link exchange public token
 */
/* jshint camelcase: false */

 'use strict';

const Bank = require('../../banks/bank');
const logger = require('../../logger');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PlaidLinkExchanger = {
    middleware: middleware,
    exchangePublicToken: exchangePublicToken,
    upgradeAccessToken: upgradeAccessToken,
    createStripeCustomer: createStripeCustomer,
    stripe: stripe,
    models: {
        Bank: Bank
    }
};

function middleware(request, response, next) {
    let publicToken = request.body.public_token;
    let roundupAccountID = request.body.roundup_account_id;
    let bankAccountID = request.body.bank_account_id;
    let stripeToken = request.body.stripe_token;
    let institution = request.body.institution;
    let error = new Error();
    let data = {success: {}};

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

    return PlaidLinkExchanger.models.Bank.findOne({type: institution})
        .then(bank => {
            if (!bank) {
                error.status = 400;
                error.message = 'Invalid institution type';
                return Promise.reject(error);
            }
            return PlaidLinkExchanger.exchangePublicToken(request.plaid, publicToken, bankAccountID);
        })
        .then(exchanged => {
            let query = {};
            data.success.plaid = true;
            query[`plaid.accounts.${institution}.id`] = roundupAccountID || bankAccountID;
            query[`plaid.accounts.${institution}.last4`] = request.body.last4;
            query[`plaid.tokens.connect.${institution}`] = exchanged.plaidAccessToken;
            query[`stripe.${institution}.ach`] = !stripeToken; // true: Stripe ACH, false: Stripe Credit Card
            let token = stripeToken || exchanged.stripeBankAccountToken;

            let stripePromise = !token ? Promise.reject({name: 'no-stripe-token'}) :
                PlaidLinkExchanger.createStripeCustomer(request.currentUser, token);

            return stripePromise
                .then(customer => {
                    query[`stripe.${institution}.customer.id`] = customer.id;
                    data.success.stripe = true;
                    return query;
                })
                .catch(error => {
                    logger.error(error);
                    // Try creating Stripe customer later. Meanwhile, store the token.
                    // PENDING: Queue retry message
                    query[`stripe.${institution}.token`] = token;
                    data.success.stripe = false;
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
 * Exchanges a Plaid public token obtained after (multi-factor) authentication for a Stripe token
 * @param  {Object} plaid - Plaid client instance
 * @param  {string} publicToken - A token received after completing the Plaid Link authentication flow
 * @param  {string} bankAccountID - The ID of the account selected by the user to be charged for donations
 * @return {Promise} - Resolves to an object with a Plaid access token and a Stripe bank account token
 */
function exchangePublicToken(plaid, publicToken, bankAccountID) {
    let error = new Error();

    return new Promise((resolve, reject) => {
        plaid.client.exchangeToken(publicToken, bankAccountID, (err, res) => {
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
            if (bankAccountID && !stripeBankAccountToken) {
                error.status = 422;
                error.message = 'Stripe token could not be retrieved';
                return reject(error);
            }

            let promise = (bankAccountID) ? Promise.resolve() :
                PlaidLinkExchanger.upgradeAccessToken(plaid, plaidAccessToken);

            promise
                .then(result => {
                    return resolve({
                        plaidAccessToken: plaidAccessToken,
                        stripeBankAccountToken: stripeBankAccountToken
                    });
                })
                .catch(reject);
        });
    });
}

/**
 * Upgrades a Plaid access token obtained for a specific product so that it works for another product
 * @param  {Object} plaid - Plaid client instance
 */
function upgradeAccessToken(plaid, token, product) {
    let options = {};
    return new Promise((resolve, reject) => {
        plaid.client.upgradeUser(token, product || 'connect', options,
            (err, mfaResponse, response) => {
                if (err && err.code !== 1115) { // product already enabled
                    let error = new Error();
                    error.name = 'plaid-access-token-upgrade-error';
                    error.details = err;
                    return reject(error);
                }
                if (mfaResponse) { // MFA responses???
                    let error = new Error();
                    error.name = 'plaid-token-upgrade-requires-mfa';
                    error.details = err;
                    return reject(error);
                }

                return resolve({upgraded: true});
            }
        );
    });
}

/**
 * Create a Stripe customer on Elm's Stripe platform account using the Stripe bank account token obtained from Plaid
 * @param  {Object} user - Current user to be created as a customer after authorizing an account
 * @param  {[type]} stripeBankAccountToken - A Stripe token obtained in exchange for a Plaid public token
 * @return {Object} customer - The newly created Stripe customer object whose ID will be used as a source for charges
 */
function createStripeCustomer(user, stripeBankAccountToken) {
    return PlaidLinkExchanger.stripe.customers.create({
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

module.exports = PlaidLinkExchanger;
