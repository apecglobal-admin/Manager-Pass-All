const { contextBridge } = require('electron');
const { version } = require('../package.json');

contextBridge.exposeInMainWorld('apecDesktop', {
  platform: process.platform,
  version
});
