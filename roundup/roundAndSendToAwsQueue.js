/**
 * This process is in charge of query plaid service, round up every transaction received
 * and send the result to AWS queue service
 */
'use strict';

/**
 * Load environment variables
 */
require('dotenv').config();

/**
 * MongoDB configuration
 */
require('../config/database');

const https = require('https');
const http = require('http');
const querystring = require('querystring');
const crypto = require('crypto');
const logger = require('../logger');
const padNumber = require('../helpers/padNumber');
const transactionFilter = require('../helpers/plaidTransactionFilter');
const transactionChain = require('../helpers/transactionChain');
const roundup = require('../helpers/roundup');
const createPlaidTransaction = require('../transactions/create');
const getTransaction = require('../transactions/chain/read');
const createTransaction = require('../transactions/chain/create');
const getAddress = require('../addresses/read');
const AWSQueue = require('../lib/awsQueue');
const stringify = require('json-stable-stringify');

const elliptic = require('elliptic');
const ed25519 = new elliptic.ec('ed25519');

const yesterdate = new Date(Date.now() - (1000 * 60 * 60 * 48));
const YESTERDAY = `${yesterdate.getFullYear()}-${padNumber(yesterdate.getMonth() + 1)}-${padNumber(yesterdate.getDate())}`;

const options = {
    host: process.env.PLAID_ENV.replace('https://', ''),
    method: 'POST',
    path: '/connect/get',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
    },
};

let _result = '';

/**
 * Sends an https request to plaid requesting user history data
 * @param {object} personData Its needed personID, along with person plaid access token
 */
function request(personData) {
    console.assert(personData && personData.token, 'Person NPO token is missing');

    const postData = querystring.stringify({
        'client_id': process.env.PLAID_CLIENTID,
        'secret': process.env.PLAID_SECRET,
        'access_token': personData.token,
        'options': {
            'gte':  YESTERDAY,
        }
    });

    let req = https.request(options, requestHandler.bind(null, personData));

    req.on('error', logger.error);
    req.write(postData);
    req.end();
}

function requestHandler(personData, res) {
    res.setEncoding('utf8');

    _result = '';

    res.on('data', chunk => _result += chunk);

    res.on('end', () => {

        if (res.statusCode !== 200) {
            logger.error({ err: _result }, 'There was an error with the https request');
            _result = '';
            return;
        }

        processData(_result, personData).then(() => {
            _result = '';

            // We tell main process we are ready for more work
            process.send('ready');
        }).catch(error => {
            logger.error({ err: error });

            // We tell main process we are ready for more work
            process.send('ready');
        });
    });
}

/**
 * We take the transactions array from plaid and filter out those that we don't need and that are not pending.
 * On the remaining data, we round up and save this new transaction
 * With all analized transactions we sign them and send them to AWS queue for later retrieval
 * @param {object} data         The response from Plaid
 * @param {string} personData User ID
 */
function processData(data, personData) {

    let plaidTransactions = null;

    try {

        plaidTransactions = JSON.parse(data).transactions
            .filter(transactionFilter)
            .map(roundUpAndSave.bind(null, personData));
    }
    catch (error) {
        return Promise.reject(error);
    }

    if (plaidTransactions) {

        return getPreviousChain(personData)
            .then(previousChain => {

                return Promise.all([
                    previousChain,
                    personData.address,
                    transactionChain.create(personData.address, previousChain, plaidTransactions),
                ]);
            })
            .then(saveTransactions)
            .then(sign)
            .then(sendToQueue)
            .then(sendPostToAws);
    } else {
        return Promise.resolve();
    }
}

/**
 * Takes a transaction, rounds up the amount and save this as a plaidTransaction for later processing
 * @param {string} personData
 * @param {object} transaction
 */
function roundUpAndSave(personData, transaction) {
    console.assert(personData && personData._id, 'Person ID is needed for saving Plaid Transaction');
    console.assert(transaction && transaction._id, 'Transaction ID is needed for saving Plaid Transaction');
    console.assert('amount' in transaction && typeof transaction.amount === 'number', 'Transaction amount is needed for saving Plaid Transaction');
    console.assert(transaction.date, 'Transaction date is needed for saving Plaid Transaction');
    console.assert(transaction.name, 'Transaction name is needed for saving Plaid Transaction');
    console.assert(typeof roundup === 'number', 'Roundup is needed for saving Plaid Transaction');
    
    let roundupValue = roundup(transaction.amount);

    let plaidTransaction = {
        userId: personData._id,
        transactionId: transaction._id,
        amount: transaction.amount,
        date: transaction.date,
        name: transaction.name,
        roundup: roundupValue,
        summed: false,    // This one is to know if we have already ran the process on this transaction
    };

    savePlaid(plaidTransaction);

    return plaidTransaction;
}

/**
 * We pass transaction to be saved on DB
 * @param {object} plaidTransaction
 */
function savePlaid(plaidTransaction) {
    console.assert(plaidTransaction, 'A plaidTransaction object is needed to save it on DB');

    createPlaidTransaction(plaidTransaction);
}

/**
 * Get previous transaction on transaction chain
 * @param   {object}               personData person information
 * @returns {promise<object|null>} Previous transaction object
 */
function getPreviousChain(personData) {
    console.assert(personData && personData.address, 'NPO address is needed per user to obtain latestTransaction');
    
    return getAddress({ address: personData.address })
        .then(address => {
    
            if (!address || address.length === 0) {
                let error = new Error('There is no address to get the previous transaction');
                return Promise.reject(error);
            }

            return getTransaction({ 'hash.value': address[0].latestTransaction});
        });
}

/**
 * Sends signed transactions to AWS queue
 * @param   {Array}   transactionChain Signed transactions array
 * @returns {promise}
 */
function sendToQueue(transactionChain) {
    console.assert(transactionChain && transactionChain.hash, 'A transactionChain is needed for sending to AWS queue');

    const params = { queue: process.env.AWS_SQS_URL_TO_SIGNER };

    return AWSQueue.sendMessage(transactionChain, params);
}

/**
 * We send a triggger to AWS for signing to be done on signing server
 * @returns {promise}
 */
function sendPostToAws() {
    let url = process.env.SIGNER_URL.split(':');
    
    const options = {
        host: url[0],
        port: url[1],
        path: '/aws/sqs',
        method: 'POST',
    };
    
    return new Promise(function (resolve, reject) {
        
        let request = http.request(options, function (response) {            
            response.on('error', reject);
            response.on('end', resolve);
        });
        
        request.end();
    });
}
    
/**
 * Creates a new transaction based on what was created on transaction chain.
 * We save this in order to verify transactions in case there is something wrong with
 * address server
 * @param   {Array} params  It has the previousChain, the address and the chain that we need to save
 * @returns {Array}         We just pass the array to the next function
 */
function saveTransactions(params) {
    // TODO: when nodejs implement destructuring, change params por [previousChain, address, chain]
    console.assert(params && params[2], 'We need the transactionChain for saving it on DB');
    
    // let previousChain = params[0];
    // let address = params[1];
    let chain = params[2];
    
    chain.forEach(transaction => createTransaction (transaction));
    
    return Promise.resolve(params);
}

/**
 * We create an object for signing ready for AWS to enqueue
 * @author Nando
 * @param   {Array}           params What comes from transaction chain creation
 * @returns {Promise<object>} Signature request object
 */
function sign(params) {
    // TODO: when nodejs implement destructuring, change params por [previousChain, address, chain]
    console.assert(params && params.length === 3, 'We need these three parameters for signing the transactionChain');
    
    let previousChain = params[0];
    let address = params[1];
    let chain = params[2];
    
    console.assert(previousChain.hash, 'previousChain is a valid object');
    console.assert(address, 'We need a NPO address');
    console.assert(chain.length, 'We have a transactionChain to sign');

    let signatureRequestMessage = {
        hash: {
            type: 'sha256',
        },
        payload: {
            address: address,
            previous: {
                hash: previousChain.hash,
                payload: previousChain.payload,
                signatures: previousChain.signatures,
            },
            transactions: chain,
        },
        signatures: [],
    };

    signatureRequestMessage.hash.value = crypto.createHash('sha256')
        .update(stringify(signatureRequestMessage.payload)).digest('hex');

    // If there is no signature, then we can't continue
    // TODO: Add more checks. Signature process is very picky
    let signature = ed25519.sign(signatureRequestMessage.hash.value, process.env.SERVER_PRIVATE_KEY, 'hex').toDER('hex');

    if (!signature) {
        let error = new Error('Invalid signature');
        return Promise.reject(error);
    }

    signatureRequestMessage.signatures.push({
        header: {
            alg: 'ed25519',
            kid: process.env.SERVER_KID,
        },
        signature: signature,
    });

    return Promise.resolve(signatureRequestMessage);
}

let RoundAndSend = {
    request: request,
};

module.exports = RoundAndSend;
