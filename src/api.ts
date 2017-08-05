import * as requestp from 'request-promise';
import * as request from 'request';
import * as cheerio from 'cheerio';
import * as fs from 'fs-extra';
import { flatten, range, partition, sortBy } from 'lodash';
import * as _ from 'lodash';
import * as path from 'path';

export interface Credentials {
    username: string;
    password: string;
}

export interface Chapter {
    name: string;
    language: string;
    volume: number;
    chapter: number;
    url: string;
    group: string;
    id: string
}

export interface DownloadConfig {
    language: string;
    preferredGroups: string[];
}

export class BatotoApi {
    rp: request.RequestAPI<requestp.RequestPromise, requestp.RequestPromiseOptions, request.RequiredUriUrl>;
    req: request.RequestAPI<request.Request, request.CoreOptions, request.RequiredUriUrl>;
    jar: request.CookieJar;

    constructor() {
        this.jar = request.jar();
        const config = {
            jar: this.jar
        };
        this.rp = requestp.defaults(config);
        this.req = request.defaults(config);
    }

    public async login(credentials: Credentials): Promise<any> {
        const html = await this.rp.get('https://bato.to');
        const formData = parseFormData(html);

        await this.rp.post("https://bato.to/forums/index.php?app=core&module=global&section=login&do=process", {
            headers: {
                referer: 'https://bato.to/',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36'
            },
            formData: {
                ...formData,
                ips_username: credentials.username,
                ips_password: credentials.password,
                anonymous: 1,
                rememberMe: 1
            }
        });
        const memberid = flatten(this.jar.getCookies('https://bato.to/')).filter((it: any) => it.key === 'member_id')[0];
        if (!memberid) {
            console.error(this.jar);
            throw new Error('Login failed')
        }
    }

    public async download(url: string, destinationFolder: string, config: DownloadConfig) {
        let chapters = await this.getChapters(url);
        chapters = filterChapters(chapters, config);
        for (const chapter of chapters) {
            console.log(`------Downloading chapter ${chapter.chapter}`)
            const info = await this.getPageUrls(chapter.id);
            const folder = path.join(destinationFolder, `Chapter ${lead(chapter.chapter, 4)}`);
            await fs.mkdirp(folder);
            await this.downloadChapter(info, folder);
        }
    }

    public async getChapters(url: string): Promise<Chapter[]> {
        const html = await this.rp.get(url);
        const $ = cheerio.load(html);
        const chapterRows = $('.chapters_list tr.row').toArray();
        if (chapterRows.length === 0) {
            console.error('Could not find any chapters!');
        }
        return chapterRows
            .map(toChapter)
            .filter(Boolean) as Chapter[];
    }

    public async getPageUrls(id: string): Promise<string[]>{
        const html = await this.rp('http://bato.to/areader', {
            qs: { id, p: 1 },
            headers: {
                referer: 'https://bato.to/reader',
                authority: 'bato.to',
                'x-requested-with': 'XMLHttpRequest'
            }
        });

        const $ = cheerio.load(html);

        return $('#page_select option').toArray()
            .map(it => it.attribs.value)
            .filter(distinct);
    }

    public downloadChapter(pageUrls: string[], destFolder: string): Promise<any> {
        const promises$ = pageUrls.map(url => this.downloadPage(url, destFolder))
        return Promise.all(promises$);
    }

    public async downloadPage(pageUrl: string, destFolder: string): Promise<any> {
        const matches = pageUrl.match(/#(.*)_(\d+)$/);
        if (!matches) {
            throw new Error(`Could not parse page url ${pageUrl}`);
        }
        const [, id, p] = matches;

        const html = await this.rp('http://bato.to/areader', {
            qs: { id, p },
            headers: {
                referer: 'https://bato.to/reader',
                authority: 'bato.to',
                'x-requested-with': 'XMLHttpRequest'
            }
        });

        const imageUrl = cheerio.load(html)('#comic_page').attr('src');
        await this.downloadImage(imageUrl, destFolder);
    }

    private downloadImage(imageUrl: string, destFolder: string): Promise<any> {
        const filename = singleRegex(imageUrl, /.*\/(.*)$/, `Could not parse image url ${imageUrl}`);
        const pipe = this.req.get(imageUrl).pipe(fs.createWriteStream(path.join(destFolder, filename)));

        return new Promise((res, rej) => {
            pipe.on('close', () => {
                console.log(`Downloaded finished for ${imageUrl}`)
                res();                
            })
        })
    }
}

function distinct<T>(el: T, index: number, arr: T[]): boolean {
    return arr.indexOf(el) === index;
}

function parseFormData(html: string): {auth_key: string, referer: string} {
    const $ = cheerio.load(html);
    return $('#login').serializeArray()
        .reduce((obj, el) => ({...obj, [el.name]: el.value}), {} as any);
}

function toChapter(el: CheerioElement): Chapter | null {
    const language =
        el.attribs['class'].split(" ")
        .filter(startsWith('lang_'))
        .map(toLanguage)[0];
    
    const cols = cheerio(el).find('td');
    const url = cols.eq(0).find('a').attr('href');
    const chapter = parseChapterVolume(cols.eq(0).text().trim());
    const group = cols.eq(2).text().trim();
    const id = singleRegex(url, /#(.*)$/, 'Could not parse chapter id from url');
    if (!chapter) {
        return null;
    }
    return {url, ...chapter, language, group, id};
}

function startsWith(prefix: string) {
    return function(str: string): boolean {
        return str.startsWith(prefix);
    }
}

function singleRegex(str: string, regex: RegExp, errorMessage: string): string {
    const match = str.match(regex);
    if (!match) {
        throw new Error(errorMessage);
    }
    return match[1];
}

function toLanguage(str: string): string {
    const split = str.split('_');
    if (split.length !== 2) {
        throw new Error('Could not parse language');
    }
    return split[1];
}

function parseChapterVolume(str: string): {name: string, volume: number, chapter: number} | null {
    const res = str.trim().match(/^Vol\.(\d*) Ch\.(\d*):? (?:\(v\d+\):? ?)?(.*)/);
    if (res === null || res.length !== 4) {
        console.warn(`Could not parse chapter/volume of ${str}`);
        return null;
    }
    return {
        volume: Number(res[1]),
        chapter: Number(res[2]),
        name: res[3]
    }
}

function lead(nr: number, length: number): string {
    const str = nr.toString();
    if (str.length > length) {
        throw new Error(`Image number too large: ${str.length}`);
    }
    return "0".repeat(length - str.length) + str
}

function filterChapters(chapters: Chapter[], config: DownloadConfig): any[] {
    return _(chapters)
        .filter(chapter => chapter.language === config.language)
        .groupBy(it => it.chapter)
        .values<Chapter[]>()
        .map(chgrp => sortBy(chgrp, chapterScore)[0])
        .sortBy('chapter')
        .value();

    function chapterScore(a: Chapter): number {
        let index = config.preferredGroups.indexOf(a.group)
        if (index >= 0) {
            index = config.preferredGroups.length - index;
        }
        return config.preferredGroups.length - index;
    }
}