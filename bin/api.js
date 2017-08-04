"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const requestp = require("request-promise");
const request = require("request");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const lodash_1 = require("lodash");
const _ = require("lodash");
const path = require("path");
const IMAGE_PREFIX = 'img';
const IMAGE_NUMBER_COUNT = 6;
class BatotoApi {
    constructor() {
        this.jar = request.jar();
        const config = {
            jar: this.jar
        };
        this.rp = requestp.defaults(config);
        this.req = request.defaults(config);
    }
    async login(credentials) {
        const html = await this.rp.get('https://bato.to');
        const formData = parseFormData(html);
        await this.rp.post("https://bato.to/forums/index.php?app=core&module=global&section=login&do=process", {
            headers: {
                referer: 'https://bato.to/',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36'
            },
            formData: Object.assign({}, formData, { ips_username: credentials.username, ips_password: credentials.password, anonymous: 1, rememberMe: 1 })
        });
        const memberid = lodash_1.flatten(this.jar.getCookies('https://bato.to/')).filter((it) => it.key === 'member_id')[0];
        if (!memberid) {
            console.error(this.jar);
            throw new Error('Login failed');
        }
    }
    async download(url, destinationFolder, config) {
        let chapters = await this.getChapters(url);
        chapters = filterChapters(chapters, config);
        for (const chapter of chapters) {
            console.log(`------Downloading chapter ${chapter.chapter}`);
            const info = await this.getPageUrls(chapters[0].id);
            const folder = path.join(destinationFolder, `Chapter ${chapter.chapter}`);
            await fs.mkdirp(folder);
            await this.downloadChapter(info, folder);
        }
    }
    async getChapters(url) {
        const html = await this.rp.get(url);
        const $ = cheerio.load(html);
        const chapterRows = $('.chapters_list tr.row').toArray();
        if (chapterRows.length === 0) {
            console.error('Could not find any chapters!');
        }
        return chapterRows
            .map(toChapter)
            .filter(Boolean);
    }
    async getPageUrls(id) {
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
    downloadChapter(pageUrls, destFolder) {
        const promises$ = pageUrls.map(url => this.downloadPage(url, destFolder));
        return Promise.all(promises$);
    }
    async downloadPage(pageUrl, destFolder) {
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
    downloadImage(imageUrl, destFolder) {
        const filename = singleRegex(imageUrl, /.*\/(.*)$/, `Could not parse image url ${imageUrl}`);
        const pipe = this.req.get(imageUrl).pipe(fs.createWriteStream(path.join(destFolder, filename)));
        return new Promise((res, rej) => {
            pipe.on('close', () => {
                console.log(`Downloaded finished for ${imageUrl}`);
                res();
            });
        });
    }
}
exports.BatotoApi = BatotoApi;
function distinct(el, index, arr) {
    return arr.indexOf(el) === index;
}
function parseFormData(html) {
    const $ = cheerio.load(html);
    return $('#login').serializeArray()
        .reduce((obj, el) => (Object.assign({}, obj, { [el.name]: el.value })), {});
}
function toChapter(el) {
    const language = el.attribs['class'].split(" ")
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
    return Object.assign({ url }, chapter, { language, group, id });
}
function startsWith(prefix) {
    return function (str) {
        return str.startsWith(prefix);
    };
}
function singleRegex(str, regex, errorMessage) {
    const match = str.match(regex);
    if (!match) {
        throw new Error(errorMessage);
    }
    return match[1];
}
function toLanguage(str) {
    const split = str.split('_');
    if (split.length !== 2) {
        throw new Error('Could not parse language');
    }
    return split[1];
}
function parseChapterVolume(str) {
    const res = str.trim().match(/^Vol\.(\d*) Ch\.(\d*):? (?:\(v\d+\):? ?)?(.*)/);
    if (res === null || res.length !== 4) {
        console.warn(`Could not parse chapter/volume of ${str}`);
        return null;
    }
    return {
        volume: Number(res[1]),
        chapter: Number(res[2]),
        name: res[3]
    };
}
function lead(nr) {
    const str = nr.toString();
    if (str.length > IMAGE_NUMBER_COUNT) {
        throw new Error(`Image number too large: ${str.length}`);
    }
    return "0".repeat(IMAGE_NUMBER_COUNT - str.length) + str;
}
function filterChapters(chapters, config) {
    return _(chapters)
        .filter(chapter => chapter.language === config.language)
        .groupBy(it => it.chapter)
        .values()
        .map(chgrp => lodash_1.sortBy(chgrp, chapterScore)[0])
        .sortBy('chapter')
        .value();
    function chapterScore(a) {
        let index = config.preferredGroups.indexOf(a.group);
        if (index >= 0) {
            index = config.preferredGroups.length - index;
        }
        return config.preferredGroups.length - index;
    }
}
