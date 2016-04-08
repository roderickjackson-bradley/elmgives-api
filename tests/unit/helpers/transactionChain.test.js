'use strict';

const tape = require('tape');
const crypto = require('crypto');

const chain = require('../../../helpers/transactionChain');
const Transaction = require('../../../transactions/chain/transaction');
const PlaidTransaction = require('../../../transactions/plaidTransaction');

let address = 'wVdC5KxsQe2PNtHfk2vvurCiWACHWetNb4';
var amounts =  [1.23, 4.56, 7.89, 2.34, 5.67, 8.90, 3.45, 6.78, 9.01];
var roundups = [0.77, 0.44, 0.11, 0.66, 0.33, 0.10, 0.55, 0.22, 0.99];
var balances = [0.77, 1.21, 1.32, 1.98, 2.31, 2.41, 2.96, 3.18, 4.17].map(num => -num);

/* TESTS */
tape('Transaction Chain (valid)', test => {
    test.plan(2 + transactions.length * 9);

    chain.create(address, previous, transactions)
      .then(transactionChain => {
        test.equal(transactionChain.length, transactions.length, 'all input transactions get included in the chain');

        /* Numeric values and currency */
        transactionChain.map((transaction, index) => {
          let count = previous.payload.count + index + 1;

          test.equal(transaction.hash.type, previous.hash.type,
            `transaction #${count} hash is ${previous.hash.type}`);
          test.equal(transaction.payload.count, count,
            `transaction #${count} count is ${count}`);
          test.equal(transaction.payload.address, address,
            `transaction #${count} address is ${address}`);
          test.equal(transaction.payload.amount, amounts[index],
            `transaction #${count} amount is ${amounts[index]}`);
          test.equal(transaction.payload.roundup, roundups[index],
            `transaction #${count} roundup is ${roundups[index]}`);
          test.equal(transaction.payload.currency, previous.payload.currency,
            `transaction #${count} limit is ${previous.payload.currency}`);
          test.equal(transaction.payload.limit, previous.payload.limit,
            `transaction #${count} limit is ${previous.payload.limit}`);
        });

        /* Hash pointers and relative differences */
        test.equal(transactionChain[0].payload.balance, balances[0],
          `transaction #${previous.payload.count + 1} cumulative balance is ${balances[0]}`);
        test.equal(transactionChain[0].payload.previous, previous.hash.value,
          `transaction #${previous.payload.count + 1} previous hash is ok`);

        transactionChain.slice(1).map((transaction, index) => {
          let count = previous.payload.count + index + 2;
          let balance = balances[index + 1];
          
          test.equal(transaction.payload.balance, balance,
            `transaction #${count} cumulative balance is ${balance}`);
          test.equal(transaction.payload.previous, transactionChain[index].hash.value,
            `transaction #${count} previous hash is ok`);
        });


        let sum = -roundups.reduce((a, b) => a + b);
        test.equal(transactionChain[transactionChain.length - 1].payload.balance, sum,
          `the cumulative sum of all roundups is ${sum}`);
      });
});

/* INPUT TRANSACTIONS */
let previous = new Transaction({
  hash: {
    type: 'sha256'
  },
  payload: {
    count: 0,
    address: address,
    amount: 0,
    roundup: 0,
    balance: 0,
    currency: 'USD',
    limit: -10,
    previous: null,
    timestamp: new Date(),
    reference: 'plaid_transaction_id'
  },
  signatures: []
});
previous.hash.value = crypto.createHash('sha256').update(JSON.stringify(previous.payload)).digest('hex');

var transactions = amounts.map((amount, index) => {
  return new PlaidTransaction({
    transactionId: Math.floor(Math.random()*100000000),
    amount: amount,
    roundup: roundups[index],
    date: new Date(),
    name: 'info'
  });
});
