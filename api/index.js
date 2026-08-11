'use strict';

/* נקודת הכניסה של Vercel — אותה אפליקציית Express שרצה מקומית */
const { createApp } = require('../server/app');

module.exports = createApp();
