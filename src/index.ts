import { loadConfig } from './config';
import { BatotoApi } from './api';


const api = new BatotoApi();

(async () => {
    const config = await loadConfig();
    await api.login(config);
    await api.download('https://bato.to/comic/_/comics/one-piece-digital-colored-comics-r10004', 'download', config);
})().catch(console.error);
