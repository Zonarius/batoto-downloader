import * as fs from 'fs-extra';

export interface Config {
    username: string;
    password: string;
    language: string;
    preferredGroups: string[];
}

export function loadConfig(): Promise<Config> {
    return fs.readFile('config.json', 'utf-8').then(JSON.parse);
}