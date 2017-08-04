"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs-extra");
function loadConfig() {
    return fs.readFile('config.json', 'utf-8').then(JSON.parse);
}
exports.loadConfig = loadConfig;
