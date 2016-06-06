'use strict';

const tape = require('tape');
const Bank = require('../../../banks/bank');
const types = require('../types');
const required = require('../required');
const defaults = require('../defaults');

tape('Bank model', test => {
    test.plan(23);

    let bank = new Bank({});
    let values = bank.schema.paths;
    let stringProperties = ['name', 'description', 'logoUrl', 'email', 'phone'];

    types(stringProperties, values, test, 'String');
    types(['createdAt', 'updatedAt'], values, test, 'Date');
    types(['archived', 'active'], values, test, 'Boolean');
    types(['address'], values, test, 'Mixed');
    types(['userId'], values, test, 'ObjectID');

    defaults(['active'], bank.schema.tree, test, true);
    defaults(['archived'], bank.schema.tree, test, false);

    bank.validate(error => {
        let fields = [
            'userId', 'name', 'description', 'logoUrl', 'email', 'phone',
            'hasMultiFactorAuthentication', 'products', 'type'
        ];

        required(fields, error.errors, test);
    });

    new Bank({
        userId: '4e137bd81a6a8e00000007ac',
        name: 'foobar',
        type: 'foobar',
        description: 'barfoo',
        logoUrl: 'http://localhost',
        email: 'foo@bar.com',
        phone: 'some phone',
        hasMultiFactorAuthentication: true,
        products: [{}]
    }).validate(error => test.equal(undefined, error, 'valid with attributes'));
});
