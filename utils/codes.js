'use strict';

const generateCode     = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const generateUserCode = () => '#' + Math.floor(10000 + Math.random() * 90000);

module.exports = { generateCode, generateUserCode };
