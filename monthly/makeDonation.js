'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Uses Stripe API to make a donation on behalf on [[connectedStripeAccount]]
 * @param {Number}    amount
 * @param {String}    currency                'usd' for now
 * @param {String}    connectedStripeAccount

 * @param {generator} generator
 */
function makeDonation(amount, currency, customer, connectedStripeAccount, fee, generator) {

  stripe.charges.create({
    amount: amount,
    currency: currency,
    customer: customer,
    destination: connectedStripeAccount,
    /* jshint camelcase: false */
    application_fee: fee,
  })
  .then(charge => generator.next(charge))
  .catch(error => generator.throw(error));
}

module.exports = makeDonation;
