'use strict';

const tape = require('tape');
const crypto = require('crypto');

const chain = require('../../../helpers/transactionChain');
const Transaction = require('../../../transactions/chain/transaction');
const PlaidTransaction = require('../../../transactions/plaidTransaction');
const stringify = require('json-stable-stringify');

let address = 'wVdC5KxsQe2PNtHfk2vvurCiWACHWetNb4';
let amounts =  [1.23, 4.56, 7.89, 2.34, 5.67, 8.90, 3.45, 6.78, 9.01];
let roundups = [0.77, 0.44, 0.11, 0.66, 0.33, 0.10, 0.55, 0.22, 0.99];
let balances = [0.77, 1.21, 1.32, 1.98, 2.31, 2.41, 2.96, 3.18, 4.17].map(num => -num);

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
previous.hash.value = crypto.createHash('sha256')
    .update(stringify(previous.payload)).digest('hex');

let transactions = amounts.map((amount, index) => {
    return new PlaidTransaction({
        transactionId: Math.floor(Math.random()*100000000),
        amount: amount,
        roundup: roundups[index],
        date: new Date(),
        name: 'info'
    });
});

/* TESTS */
tape('Transaction Data', test => {
    test.plan(19);
    let error;
    let data;
    let input = {
        amount: 1.23,
        badAmount: 'a',
        roundup: 0.77,
        badRoundup: 'r',
        date: '2016-04-15T17:00:27.772Z',
        transactionId: 1
    };
    
    error = chain.createTransaction(undefined, previous, previous.hash.value);
    test.equal(error.message, 'invalid-transaction-input', 'fails on non-object input');

    error = chain.createTransaction({}, previous, previous.hash.value);
    test.equal(error.message, 'invalid-transaction-amount', 'fails on missing transaction amount');

    error = chain.createTransaction({amount: input.badAmount}, previous, previous.hash.value);
    test.equal(error.message, 'invalid-transaction-amount', 'fails on invalid transaction amount');

    error = chain.createTransaction({amount: input.amount}, previous, previous.hash.value);
    test.equal(error.message, 'invalid-transaction-roundup', 'fails on missing transaction roundup');

    error = chain.createTransaction({amount: input.amount, roundup: input.badRoundup}, previous, previous.hash.value);
    test.equal(error.message, 'invalid-transaction-roundup', 'fails on invalid transaction roundup');

    data = chain.createTransaction(input, previous, previous.hash.value);
    test.equal(data instanceof Error, false, 'succeeds with valid amount and roundup');
    test.equal(data.hash.type, previous.hash.type, 'transaction hash type matches');
    test.equal(data.payload instanceof Object, true, 'transaction payload is an object');
    test.equal(data.signatures instanceof Array, true, 'transaction signatures is an array');

    test.equal(data.payload.count, previous.payload.count + 1, `transaction count is ${previous.payload.count + 1}`);
    test.equal(data.payload.address, address, `transaction amount is ${address}`);
    test.equal(data.payload.amount, input.amount, `transaction amount is ${input.amount}`);
    test.equal(data.payload.roundup, input.roundup, `transaction amount is ${input.roundup}`);
    test.equal(data.payload.balance, previous.payload.balance - data.payload.roundup, `transaction balance is ok`);
    test.equal(data.payload.currency, previous.payload.currency, `transaction currency is ${previous.payload.currency}`);
    test.equal(data.payload.limit, previous.payload.limit, `transaction limit is ${previous.payload.limit}`);
    test.equal(data.payload.previous, previous.hash.value, 'previous transaction hash matches');
    test.equal(data.payload.timestamp, input.date, `transaction timestamp is ${input.date}`);
    test.equal(data.payload.reference, input.transactionId, `transaction reference is ${input.transactionId}`);
});

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

tape('Transaction Chain (invalid)', test => {
    let length = transactions.length;
    test.plan(6);

    chain.create('different-address', previous, transactions)
        .then(() => test.fail('did not reject on address mismatch'))
        .catch(error => test.equal(error.message, 'address-mismatch', 'rejects on address mismatch'));

    let sequentialTests = [
        index => {
            transactions[length - 1] = undefined;
            chain.create(address, previous, transactions)
                .then(() => test.fail('did not reject non-object transaction input'))
                .catch(error => {
                    test.equal(error.message, 'invalid-transaction-input', 'rejects non-object transaction input');
                    next(++index);
                });
        },
        index => {
            transactions[length - 2].amount = undefined;
            chain.create(address, previous, transactions)
                .then(() => test.fail('did not reject on missing amount'))
                .catch(error => {
                    test.equal(error.message, 'invalid-transaction-amount', 'rejects on missing amount');
                    next(++index);
                });
        },
        index => {
            transactions[length - 3].roundup = undefined;
            chain.create(address, previous, transactions)
                .then(() => test.fail('did not reject on missing roundup'))
                .catch(error => {
                    test.equal(error.message, 'invalid-transaction-roundup', 'rejects on missing roundup');
                    next(++index);
                });
        },
        index => {
            previous.hash.value = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            chain.create(address, previous, transactions)
                .then(() => test.fail('did not reject on previous hash mismatch'))
                .catch(error => {
                  test.equal(error.message, 'previous-transaction-hash-mismatch', 'rejects on previous hash mismatch');
                  next(++index);
                });
        },
        index => {
            previous.payload = {address: address};
            chain.create(address, previous, transactions)
                .then(() => test.fail('did not reject invalid previous transaction'))
                .catch(error => {
                  test.equal(error.message, 'invalid-previous-transaction', 'rejects invalid previous transaction');
                  next(++index);
                });
        }
    ];

    function next(index) {
        return typeof sequentialTests[index] === 'function' ? sequentialTests[index](index) : undefined;
    }

    next(0);
});
