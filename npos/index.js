/**
 * Manage Non Profift Organizations
 *  create
 *  update
 *  get single and list
 *  archive
 *  delete
 */
'use strict';

const Npo = require('./npo');
const router = require('express').Router();
const create = require('../lib/create');
const list = require('../lib/list');
const show = require('../lib/show');
const update = require('../lib/update');
const archive = require('../lib/archive');

const PATH = '/npos';
const SINGLE = '/npos/:id';

router
    .get(PATH, list(Npo))
    .post(PATH, create(Npo))
    .get(SINGLE, show(Npo))
    .put(SINGLE, update(Npo))
    .delete(SINGLE, archive(Npo));

module.exports = router;
