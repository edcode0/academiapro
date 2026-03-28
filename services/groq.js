'use strict';

const Groq = require('groq-sdk');

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy' });

module.exports = groqClient;
