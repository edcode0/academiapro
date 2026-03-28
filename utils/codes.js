'use strict';
const crypto = require('crypto');

const generateCode     = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const generateUserCode = () => '#' + crypto.randomInt(10000, 99999).toString();

module.exports = { generateCode, generateUserCode };
