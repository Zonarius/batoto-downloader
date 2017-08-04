"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const api_1 = require("./api");
const api = new api_1.BatotoApi();
(async () => {
    const config = await config_1.loadConfig();
    await api.login(config);
    await api.download('https://bato.to/comic/_/comics/one-piece-digital-colored-comics-r10004', 'download', config);
})().catch(console.error);
