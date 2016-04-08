/**
 * Queries PLAID servers for user account information in order to round up the sum to donate to NOPs
 */

'use strict';

const querystring             = require('querystring');
const https                   = require('https');
const logger                  = require('../logger');
const create                  = require('../transactions/create');
const getTransaction          = require('../transactions/chain/read');
const padNumber               = require('../helpers/padNumber');
const roundup                 = require('../helpers/roundup');
const transactionFilter       = require('../helpers/plaidTransactionFilter');
const AWSQueue                = require('../lib/awsQueue');
const createTransactionChain  = require('../lib/createTransactionChain');

const PLAID_SERVER = process.env.PLAID_ENV || 'tartan.plaid.com';

const yesterdate  = new Date(Date.now() - (1000 * 60 * 60 * 24));
const YESTERDAY   = `${yesterdate.getFullYear()}-${padNumber(yesterdate.getMonth() + 1)}-${padNumber(yesterdate.getDate())}`;

const options = {
    host   : PLAID_SERVER,
    method : 'POST',
    path   : '/connect/get',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
    },
};

const Worker = {

    /**
     * Add eventListener to supervisor in order to request information to Plaid with userData sent by
     * supervisor
     */
    init() {
        process.on('message', this.askForWork.bind(this));

        // Tell main process I'm ready to work
        process.send('ready');
    },

    /**
     * If I receive a 'finish' String, it's time to exist. Otherwise I received a person and I have to analize it
     * @param {string|object} msg 'finish' or an object with '_id' and 'token' properties
     */
    askForWork(msg) {

        if (msg === 'finish') {
            process.exit(0);
            return;
        }

        this.request(msg);
    },

    /**
     * Sends an https request to plaid requesting user history data
     * @param {object} personData Its needed personID, along with person plaid access token
     */
    request(personData) {

        const postData = querystring.stringify({
            'client_id'   : process.env.PLAID_CLIENTID || 'test_id',
            'secret'      : process.env.PLAID_SECRET || 'test_secret',
            'access_token': personData.token,
            'options'     : {
              'gte':  YESTERDAY,
            }
        });

        let req = https.request(options, this.requestHandler.bind(this, personData));

        req.on('error', logger.error);
        req.write(postData);
        req.end();
    },

    requestHandler(personData, res) {
        res.setEncoding('utf8');

        this.result = '';

        res.on('data', chunk => this.result += chunk);

        res.on('end', () => {

            if (res.statusCode !== 200) {
                logger.error({ err: this.result }, 'There was an error with the https request');
                this.result = '';
                return;
            }

            this.processData(this.result, personData).then(() => {

                this.result = '';

                // We tell main process we are ready for more work
                process.send('ready');
            }).catch(logger.error);

        });
    },

    /**
     * We take the transactions array from plaid and filter out those that we don't need and that are not pending.
     * On the remaining data, we round up and save this new transaction
     * With all analized transactions we sign them and send them to AWS queue for later retrieval
     * @param {object} data         The response from Plaid
     * @param {string} personData User ID
     */
    processData(data, personData) {

		let plaidTransactions = null;

        try {

            plaidTransactions = JSON.parse(data).transactions
                .filter(transactionFilter)
                .map(this.roundUpAndSave.bind(this, personData));
        }
        catch (error) {
            logger.error({ err: error });
        }

		if (plaidTransactions) {

			return this.getPreviousChain(plaidTransactions)
                .then(previousChain => createTransactionChain(personData.address, previousChain, plaidTransactions))
                .then(this.sendToQueue)
                .catch(logger.error);
		} else {
            return Promise.resolve();
        }
    },

    /**
     * Takes a transaction, rounds up the amount and save this as a plaidTransaction for later processing
     * @param {string} personData
     * @param {object} transaction
     */
    roundUpAndSave(personData, transaction) {
        let roundupValue = roundup(transaction.amount);

        let plaidTransaction = {
            userId       : personData._id,
            transactionId: transaction._id,
            amount       : transaction.amount,
            date         : transaction.date,
            name         : transaction.name,
            roundup      : roundupValue,
            summed       : false,    // This one is to know if we have already ran the process on this transaction
        };

        this.save(plaidTransaction, personData);

		return plaidTransaction;
    },

    /**
     * We pass transaction to be saved on DB
     * @param {object} plaidTransaction
     */
    save(plaidTransaction) {
       create(plaidTransaction);
    },

	/**
	 * Get previous transaction on transaction chain
	 * @param   {object}               personData person information
	 * @returns {promise<object|null>} Previous transaction object
	 */
	getPreviousChain(personData) {
		return getTransaction({ _id: personData.latestTransaction});
	},

	/**
	 * Sends signed transactions to AWS queue
	 * @param   {Array}   transactionChain Signed transactions array
	 * @returns {promise}
	 */
	sendToQueue(transactionChain) {
        const params = { queue: process.env.AWS_SQS_URL_TO_SIGNER };

		return AWSQueue.sendMessage(transactionChain, params);
	},
};

module.exports = Worker;
