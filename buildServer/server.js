"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("./config"));
const fs_1 = __importDefault(require("fs"));
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const compression_1 = __importDefault(require("compression"));
const os_1 = __importDefault(require("os"));
const cors_1 = __importDefault(require("cors"));
const ioredis_1 = __importDefault(require("ioredis"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const youtube_1 = require("./utils/youtube");
const room_1 = require("./room");
const redis_1 = require("./utils/redis");
const stripe_1 = require("./utils/stripe");
const firebase_1 = require("./utils/firebase");
const path_1 = __importDefault(require("path"));
const pg_1 = require("pg");
const time_1 = require("./utils/time");
const utils_1 = require("./vm/utils");
const string_1 = require("./utils/string");
const postgres_1 = require("./utils/postgres");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const zlib_1 = __importDefault(require("zlib"));
const util_1 = __importDefault(require("util"));
const ecosystem_config_1 = __importDefault(require("./ecosystem.config"));
const statsAgg_1 = require("./utils/statsAgg");
const resolveShard_1 = require("./utils/resolveShard");
const moniker_1 = require("./utils/moniker");
if (config_1.default.NODE_ENV === 'development') {
    axios_1.default.interceptors.request.use((config) => {
        // console.log(config);
        return config;
    }, (error) => {
        console.error(error);
    });
}
const gzip = util_1.default.promisify(zlib_1.default.gzip);
const releaseInterval = 5 * 60 * 1000;
const releaseBatches = 10;
const app = (0, express_1.default)();
let server = null;
if (config_1.default.HTTPS) {
    const key = fs_1.default.readFileSync(config_1.default.SSL_KEY_FILE);
    const cert = fs_1.default.readFileSync(config_1.default.SSL_CRT_FILE);
    server = https_1.default.createServer({ key: key, cert: cert }, app);
}
else {
    server = new http_1.default.Server(app);
}
const io = new socket_io_1.Server(server, { cors: {}, transports: ['websocket'] });
let redis = undefined;
if (config_1.default.REDIS_URL) {
    redis = new ioredis_1.default(config_1.default.REDIS_URL);
}
let postgres = undefined;
if (config_1.default.DATABASE_URL) {
    postgres = new pg_1.Client({
        connectionString: config_1.default.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    postgres.connect();
}
const launchTime = Number(new Date());
const rooms = new Map();
init();
function init() {
    return __awaiter(this, void 0, void 0, function* () {
        if (postgres) {
            console.time('[LOADROOMSPOSTGRES]');
            const persistedRooms = yield getAllRooms();
            console.log('found %s rooms in postgres', persistedRooms.length);
            for (let i = 0; i < persistedRooms.length; i++) {
                const key = persistedRooms[i].roomId;
                const data = persistedRooms[i].data
                    ? JSON.stringify(persistedRooms[i].data)
                    : undefined;
                const room = new room_1.Room(io, key, data);
                rooms.set(key, room);
            }
            console.timeEnd('[LOADROOMSPOSTGRES]');
        }
        if (!rooms.has('/default')) {
            rooms.set('/default', new room_1.Room(io, '/default'));
        }
        server.listen(config_1.default.PORT, config_1.default.HOST);
        // Following functions iterate over in-memory rooms
        setInterval(minuteMetrics, 60 * 1000);
        setInterval(release, releaseInterval / releaseBatches);
        setInterval(freeUnusedRooms, 5 * 60 * 1000);
        saveRooms();
        if (process.env.NODE_ENV === 'development') {
            try {
                require('./vmWorker');
                // require('./syncSubs');
                // require('./timeSeries');
            }
            catch (e) {
                console.error(e);
            }
        }
    });
}
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.raw({ type: 'text/plain', limit: 1000000 }));
app.get('/ping', (_req, res) => {
    res.json('pong');
});
// Data's already compressed so go before the compression middleware
app.get('/subtitle/:hash', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const gzipped = yield (redis === null || redis === void 0 ? void 0 : redis.getBuffer('subtitle:' + req.params.hash));
    if (!gzipped) {
        return res.status(404).end('not found');
    }
    res.setHeader('Content-Encoding', 'gzip');
    res.end(gzipped);
}));
app.use((0, compression_1.default)());
app.post('/subtitle', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = req.body;
    if (!redis) {
        return;
    }
    // calculate hash, gzip and save to redis
    const hash = crypto_1.default
        .createHash('sha256')
        .update(data, 'utf8')
        .digest()
        .toString('hex');
    let gzipData = (yield gzip(data));
    yield redis.setex('subtitle:' + hash, 24 * 60 * 60, gzipData);
    (0, redis_1.redisCount)('subUploads');
    return res.json({ hash });
}));
app.get('/downloadSubtitles', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield axios_1.default.get(req.query.url, {
        responseType: 'arraybuffer',
    });
    res.append('Content-Encoding', 'gzip');
    res.append('Content-Type', 'text/plain');
    (0, redis_1.redisCount)('subDownloadsOS');
    res.end(response.data);
}));
app.get('/searchSubtitles', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const title = req.query.title;
        const url = req.query.url;
        let subUrl = '';
        if (url) {
            const startResp = yield (0, axios_1.default)({
                method: 'get',
                url: url,
                headers: {
                    Range: 'bytes=0-65535',
                },
                responseType: 'arraybuffer',
            });
            const start = startResp.data;
            const size = Number(startResp.headers['content-range'].split('/')[1]);
            const endResp = yield (0, axios_1.default)({
                method: 'get',
                url: url,
                headers: {
                    Range: `bytes=${size - 65536}-`,
                },
                responseType: 'arraybuffer',
            });
            const end = endResp.data;
            // console.log(start, end, size);
            let hash = computeOpenSubtitlesHash(start, end, size);
            // hash = 'f65334e75574f00f';
            // Search API for subtitles by hash
            subUrl = `https://rest.opensubtitles.org/search/moviebytesize-${size}/moviehash-${hash}/sublanguageid-eng`;
        }
        else if (title) {
            subUrl = `https://rest.opensubtitles.org/search/query-${encodeURIComponent(title)}/sublanguageid-eng`;
        }
        console.log(subUrl);
        const response = yield axios_1.default.get(subUrl, {
            headers: { 'User-Agent': 'VLSub 0.10.2' },
        });
        // console.log(response);
        const subtitles = response.data;
        res.json(subtitles);
    }
    catch (e) {
        console.error(e.message);
        res.json([]);
    }
    (0, redis_1.redisCount)('subSearchesOS');
}));
app.get('/stats', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (req.query.key && req.query.key === config_1.default.STATS_KEY) {
        const stats = yield getStats();
        res.json(stats);
    }
    else {
        return res.status(403).json({ error: 'Access Denied' });
    }
}));
app.get('/statsAgg', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (req.query.key && req.query.key === config_1.default.STATS_KEY) {
        const stats = yield (0, statsAgg_1.statsAgg)();
        res.json(stats);
    }
    else {
        return res.status(403).json({ error: 'Access Denied' });
    }
}));
app.get('/health/:metric', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const vmManagerStats = (yield axios_1.default.get('http://localhost:' + config_1.default.VMWORKER_PORT + '/stats')).data;
    const result = (_b = (_a = vmManagerStats[req.params.metric]) === null || _a === void 0 ? void 0 : _a.availableVBrowsers) === null || _b === void 0 ? void 0 : _b.length;
    res.status(result ? 200 : 500).json(result);
}));
app.get('/timeSeries', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (req.query.key && req.query.key === config_1.default.STATS_KEY && redis) {
        const timeSeriesData = yield redis.lrange('timeSeries', 0, -1);
        const timeSeries = timeSeriesData.map((entry) => JSON.parse(entry));
        res.json(timeSeries);
    }
    else {
        return res.status(403).json({ error: 'Access Denied' });
    }
}));
app.get('/youtube', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof req.query.q === 'string') {
        try {
            yield (0, redis_1.redisCount)('youtubeSearch');
            const items = yield (0, youtube_1.searchYoutube)(req.query.q);
            res.json(items);
        }
        catch (_c) {
            return res.status(500).json({ error: 'youtube error' });
        }
    }
    else {
        return res.status(500).json({ error: 'query must be a string' });
    }
}));
app.post('/createRoom', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e, _f;
    const genName = () => '/' + (0, moniker_1.makeRoomName)(config_1.default.SHARD);
    let name = genName();
    console.log('createRoom: ', name);
    const newRoom = new room_1.Room(io, name);
    if (postgres) {
        const now = new Date();
        const roomObj = {
            roomId: newRoom.roomId,
            lastUpdateTime: now,
            creationTime: now,
        };
        try {
            yield (0, postgres_1.insertObject)(postgres, 'room', roomObj);
        }
        catch (e) {
            (0, redis_1.redisCount)('createRoomError');
        }
    }
    const decoded = yield (0, firebase_1.validateUserToken)((_d = req.body) === null || _d === void 0 ? void 0 : _d.uid, (_e = req.body) === null || _e === void 0 ? void 0 : _e.token);
    newRoom.creator = decoded === null || decoded === void 0 ? void 0 : decoded.email;
    const preload = (((_f = req.body) === null || _f === void 0 ? void 0 : _f.video) || '').slice(0, 20000);
    if (preload) {
        (0, redis_1.redisCount)('createRoomPreload');
        newRoom.video = preload;
        newRoom.paused = true;
        yield newRoom.saveRoom();
    }
    rooms.set(name, newRoom);
    res.json({ name });
}));
app.post('/manageSub', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _g, _h, _j;
    const decoded = yield (0, firebase_1.validateUserToken)((_g = req.body) === null || _g === void 0 ? void 0 : _g.uid, (_h = req.body) === null || _h === void 0 ? void 0 : _h.token);
    if (!decoded) {
        return res.status(400).json({ error: 'invalid user token' });
    }
    if (!decoded.email) {
        return res.status(400).json({ error: 'no email found' });
    }
    const customer = yield (0, stripe_1.getCustomerByEmail)(decoded.email);
    if (!customer) {
        return res.status(400).json({ error: 'customer not found' });
    }
    const session = yield (0, stripe_1.createSelfServicePortal)(customer.id, (_j = req.body) === null || _j === void 0 ? void 0 : _j.return_url);
    return res.json(session);
}));
app.delete('/deleteAccount', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _k, _l;
    // TODO pass this in req.query instead
    const decoded = yield (0, firebase_1.validateUserToken)((_k = req.body) === null || _k === void 0 ? void 0 : _k.uid, (_l = req.body) === null || _l === void 0 ? void 0 : _l.token);
    if (!decoded) {
        return res.status(400).json({ error: 'invalid user token' });
    }
    if (postgres) {
        // Delete rooms
        yield (postgres === null || postgres === void 0 ? void 0 : postgres.query('DELETE FROM room WHERE owner = $1', [decoded.uid]));
        // Delete linked accounts
        yield (postgres === null || postgres === void 0 ? void 0 : postgres.query('DELETE FROM link_account WHERE uid = $1', [
            decoded.uid,
        ]));
    }
    yield (0, firebase_1.deleteUser)(decoded.uid);
    (0, redis_1.redisCount)('deleteAccount');
    return res.json({});
}));
app.get('/metadata', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _m, _o, _p, _q;
    const decoded = yield (0, firebase_1.validateUserToken)((_m = req.query) === null || _m === void 0 ? void 0 : _m.uid, (_o = req.query) === null || _o === void 0 ? void 0 : _o.token);
    let isCustomer = false;
    let isSubscriber = false;
    if (decoded === null || decoded === void 0 ? void 0 : decoded.email) {
        const customer = yield (0, stripe_1.getCustomerByEmail)(decoded.email);
        // Is the user an active subscriber?
        isSubscriber = Boolean((_q = (_p = customer === null || customer === void 0 ? void 0 : customer.subscriptions) === null || _p === void 0 ? void 0 : _p.data) === null || _q === void 0 ? void 0 : _q.find((sub) => (sub === null || sub === void 0 ? void 0 : sub.status) === 'active'));
        // Has the user ever been a subscriber?
        isCustomer = Boolean(customer);
    }
    let isFreePoolFull = false;
    try {
        isFreePoolFull = (yield axios_1.default.get('http://localhost:' + config_1.default.VMWORKER_PORT + '/isFreePoolFull')).data.isFull;
    }
    catch (e) {
        console.warn(e);
    }
    const beta = (decoded === null || decoded === void 0 ? void 0 : decoded.email) != null &&
        Boolean(config_1.default.BETA_USER_EMAILS.split(',').includes(decoded === null || decoded === void 0 ? void 0 : decoded.email));
    const streamPath = beta ? config_1.default.STREAM_PATH : undefined;
    // log metrics but don't wait for it
    if (postgres && (decoded === null || decoded === void 0 ? void 0 : decoded.uid)) {
        (0, postgres_1.upsertObject)(postgres, 'active_user', { uid: decoded === null || decoded === void 0 ? void 0 : decoded.uid, lastActiveTime: new Date() }, { uid: true });
    }
    return res.json({
        isSubscriber,
        isCustomer,
        isFreePoolFull,
        beta,
        streamPath,
    });
}));
app.get('/resolveRoom/:vanity', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _r;
    const vanity = req.params.vanity;
    const result = yield (postgres === null || postgres === void 0 ? void 0 : postgres.query(`SELECT "roomId", vanity from room WHERE LOWER(vanity) = $1`, [(_r = vanity === null || vanity === void 0 ? void 0 : vanity.toLowerCase()) !== null && _r !== void 0 ? _r : '']));
    // console.log(vanity, result.rows);
    // We also use this for checking name availability, so just return empty response if it doesn't exist (http 200)
    return res.json(result === null || result === void 0 ? void 0 : result.rows[0]);
}));
app.get('/resolveShard/:roomId', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const shardNum = (0, resolveShard_1.resolveShard)(req.params.roomId);
    return res.send(String(config_1.default.SHARD ? shardNum : ''));
}));
app.get('/listRooms', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _s, _t, _u;
    const decoded = yield (0, firebase_1.validateUserToken)((_s = req.query) === null || _s === void 0 ? void 0 : _s.uid, (_t = req.query) === null || _t === void 0 ? void 0 : _t.token);
    if (!decoded) {
        return res.status(400).json({ error: 'invalid user token' });
    }
    const result = yield (postgres === null || postgres === void 0 ? void 0 : postgres.query(`SELECT "roomId", vanity from room WHERE owner = $1`, [decoded.uid]));
    return res.json((_u = result === null || result === void 0 ? void 0 : result.rows) !== null && _u !== void 0 ? _u : []);
}));
app.delete('/deleteRoom', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _v, _w;
    const decoded = yield (0, firebase_1.validateUserToken)((_v = req.query) === null || _v === void 0 ? void 0 : _v.uid, (_w = req.query) === null || _w === void 0 ? void 0 : _w.token);
    if (!decoded) {
        return res.status(400).json({ error: 'invalid user token' });
    }
    const result = yield (postgres === null || postgres === void 0 ? void 0 : postgres.query(`DELETE from room WHERE owner = $1 and "roomId" = $2`, [decoded.uid, req.query.roomId]));
    return res.json(result === null || result === void 0 ? void 0 : result.rows);
}));
app.get('/linkAccount', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _x, _y;
    const decoded = yield (0, firebase_1.validateUserToken)((_x = req.query) === null || _x === void 0 ? void 0 : _x.uid, (_y = req.query) === null || _y === void 0 ? void 0 : _y.token);
    if (!decoded) {
        return res.status(400).json({ error: 'invalid user token' });
    }
    if (!postgres) {
        return res.status(400).json({ error: 'invalid database client' });
    }
    // Get the linked accounts for the user
    let linkAccounts = [];
    if (decoded === null || decoded === void 0 ? void 0 : decoded.uid) {
        const result = yield (postgres === null || postgres === void 0 ? void 0 : postgres.query('SELECT kind, accountid, accountname, discriminator FROM link_account WHERE uid = $1', [decoded === null || decoded === void 0 ? void 0 : decoded.uid]));
        linkAccounts = result.rows;
    }
    return res.json(linkAccounts);
}));
app.post('/linkAccount', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _z, _0, _1, _2;
    const decoded = yield (0, firebase_1.validateUserToken)((_z = req.body) === null || _z === void 0 ? void 0 : _z.uid, (_0 = req.body) === null || _0 === void 0 ? void 0 : _0.token);
    if (!decoded) {
        return res.status(400).json({ error: 'invalid user token' });
    }
    if (!postgres) {
        return res.status(400).json({ error: 'invalid database client' });
    }
    const kind = (_1 = req.body) === null || _1 === void 0 ? void 0 : _1.kind;
    if (kind === 'discord') {
        const tokenType = (_2 = req.body) === null || _2 === void 0 ? void 0 : _2.tokenType;
        const accessToken = req.body.accessToken;
        // Get the token and verify the user
        const response = yield axios_1.default.get('https://discord.com/api/users/@me', {
            headers: {
                authorization: `${tokenType} ${accessToken}`,
            },
        });
        const accountid = response.data.id;
        const accountname = response.data.username;
        const discriminator = response.data.discriminator;
        // Store the user id, username, discriminator
        yield (0, postgres_1.upsertObject)(postgres, 'link_account', {
            accountid: accountid,
            accountname: accountname,
            discriminator: discriminator,
            uid: decoded.uid,
            kind: kind,
        }, { uid: true, kind: true });
        return res.json({});
    }
}));
app.delete('/linkAccount', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _3, _4;
    // TODO read from req.query instead
    const decoded = yield (0, firebase_1.validateUserToken)((_3 = req.body) === null || _3 === void 0 ? void 0 : _3.uid, (_4 = req.body) === null || _4 === void 0 ? void 0 : _4.token);
    if (!decoded) {
        return res.status(400).json({ error: 'invalid user token' });
    }
    if (!postgres) {
        return res.status(400).json({ error: 'invalid database client' });
    }
    yield postgres.query('DELETE FROM link_account WHERE uid = $1 AND kind = $2', [decoded.uid, req.body.kind]);
    res.json({});
}));
app.get('/generateName', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return res.send((0, moniker_1.makeUserName)());
}));
// Proxy video segments
app.get('/proxy/*', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (req.path.includes('index-dvr.m3u8')) {
            // VOD
            // https://d2vjef5jvl6bfs.cloudfront.net/3012391a6c3e84c79ef6_gamesdonequick_41198403369_1681059003/chunked/index-dvr.m3u8
            const resp = yield axios_1.default.get('https://' + req.query.host + req.path.slice('/proxy'.length));
            const re = /proxy\/(.*)\/chunked\/index-dvr.m3u8/;
            const rematch = re.exec(req.path);
            const host = req.query.host;
            const name = rematch === null || rematch === void 0 ? void 0 : rematch[1];
            const re2 = /(.*).ts/g;
            const repl = resp.data.replaceAll(re2, `/proxy/${name}/chunked/$1.ts?host=${host}`);
            res.send(repl);
        }
        else if (req.path.includes('/v1/playlist')) {
            // Stream
            // https://video-weaver.sea02.hls.ttvnw.net/v1/playlist/CrQEgv7Mz6nnsfJH3XtVQxeYXk8mViy1zNGWglcybvxZsI1rv3iLnjAnnqwCiVXCJ-DdD27J6RuFrLy7YUYwHUCKazIKICIupUCn9UXtaBYhBM5JIYqg9dz6NWYrCWU9HZJj2TGROv9mAOKuTR51YS82hdYL4PFZa3xxWXhgDsxXQHNDB03kY6S0aG0-EVva1xYrn5Ge6IAXRwug9QDGlb-ydtF3BtYppoTklVI7CVLySPPwbbt5Ow1JXdnKhLSwQEs4bh3BLwMnRBwUFI5nmE18BLYbkMOUivgYP5SSMgnGGlSkJO-iJNPWvepunEgyBUzB_7L-b1keTcV-Qak9IcWIITIWbRvmg6qB3ZSuWdcJgWKmdXdIn4qoRM4o16G1_0N_WRqPtMQFo0hmTlAVmHrzRArJQmaSgqAxZxRbFMd9RFeX6qjP9NtwguPbSeStdVbQxMNC34iavYUIxo8Ug812BHsG7J_kIlof2zkIqkEbP3oV3UkSByIo7xh9EEVargjaGDuQRt8zPQ6-fNBWJJe9F6IFu7lXBPIJ016lopyfcvTWjbLbBHsVkg6vG-3UISh0nud7KB5g5ipQePhtcFSI5hvjlfX1DAVHEpTWXkvlnL4wNqEqpBYL2btSXYeE1Cb-RAvrAT0s61usERcL2eI-S5aTcSO8_hxQ2afC7c9vlypOWgP6p6XNpViZHXmdXv4t-d68Z-MpLtSU7VbB3pRWnSswFFyA3W39ITic4lb97Djp3wHhGgz0Sy8aDb9r0tnphIYgASoJdXMtZWFzdC0yMKQG.m3u8
            // Extract the edge URL host and add it to URL so proxy can fetch
            const resp = yield axios_1.default.get('https://' + req.query.host + req.path.slice('/proxy'.length));
            const re = /https:\/\/(.*)\/v1\/segment\/(.*)/g;
            const match = re.exec(resp.data);
            const edgehost = match === null || match === void 0 ? void 0 : match[1];
            const repl = resp.data.replaceAll(re, `/proxy/v1/segment/$2?host=${edgehost}`);
            res.send(repl);
        }
        else {
            // Segment
            const resp = yield axios_1.default.get('https://' + req.query.host + req.path.slice('/proxy'.length), { responseType: 'arraybuffer' });
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Accept-Ranges': 'bytes',
                'Content-Length': resp.data.length,
                'Transfer-Encoding': 'chunked',
            });
            res.write(resp.data);
            res.end();
        }
    }
    catch (e) {
        console.log(e, 'axios proxy failed');
    }
}));
app.use(express_1.default.static(config_1.default.BUILD_DIRECTORY));
// Send index.html for all other requests (SPA)
app.use('/*', (_req, res) => {
    res.sendFile(path_1.default.resolve(__dirname + `/../${config_1.default.BUILD_DIRECTORY}/index.html`));
});
function saveRooms() {
    return __awaiter(this, void 0, void 0, function* () {
        while (true) {
            // console.time('[SAVEROOMS]');
            const roomArr = Array.from(rooms.values());
            for (let i = 0; i < roomArr.length; i++) {
                if (roomArr[i].roster.length) {
                    yield roomArr[i].saveRoom();
                }
            }
            // console.timeEnd('[SAVEROOMS]');
            yield new Promise((resolve) => setTimeout(resolve, 1000));
        }
    });
}
let currBatch = 0;
function release() {
    return __awaiter(this, void 0, void 0, function* () {
        // Reset VMs in rooms that are:
        // older than the session limit
        // assigned to a room with no users
        const roomArr = Array.from(rooms.values()).filter((room) => {
            return (0, string_1.hashString)(room.roomId) % releaseBatches === currBatch;
        });
        console.log('[RELEASE][%s] %s rooms in batch', currBatch, roomArr.length);
        for (let i = 0; i < roomArr.length; i++) {
            const room = roomArr[i];
            if (room.vBrowser && room.vBrowser.assignTime) {
                const maxTime = (0, utils_1.getSessionLimitSeconds)(room.vBrowser.large) * 1000;
                const elapsed = Number(new Date()) - room.vBrowser.assignTime;
                const ttl = maxTime - elapsed;
                const isTimedOut = ttl && ttl < releaseInterval;
                const isAlmostTimedOut = ttl && ttl < releaseInterval * 2;
                const isRoomEmpty = room.roster.length === 0;
                const isRoomIdle = Date.now() - Number(room.lastUpdateTime) > 5 * 60 * 1000;
                if (isTimedOut || (isRoomEmpty && isRoomIdle)) {
                    console.log('[RELEASE][%s] VM in room:', currBatch, room.roomId);
                    room.stopVBrowserInternal();
                    if (isTimedOut) {
                        room.addChatMessage(null, {
                            id: '',
                            system: true,
                            cmd: 'vBrowserTimeout',
                            msg: '',
                        });
                        (0, redis_1.redisCount)('vBrowserTerminateTimeout');
                    }
                    else if (isRoomEmpty) {
                        (0, redis_1.redisCount)('vBrowserTerminateEmpty');
                    }
                }
                else if (isAlmostTimedOut) {
                    room.addChatMessage(null, {
                        id: '',
                        system: true,
                        cmd: 'vBrowserAlmostTimeout',
                        msg: '',
                    });
                }
            }
        }
        currBatch = (currBatch + 1) % releaseBatches;
    });
}
function minuteMetrics() {
    var _a, _b, _c, _d;
    return __awaiter(this, void 0, void 0, function* () {
        const roomArr = Array.from(rooms.values());
        for (let i = 0; i < roomArr.length; i++) {
            const room = roomArr[i];
            if (room.vBrowser && room.vBrowser.id) {
                // Renew the locks
                yield (redis === null || redis === void 0 ? void 0 : redis.expire('lock:' + room.vBrowser.provider + ':' + room.vBrowser.id, 300));
                yield (redis === null || redis === void 0 ? void 0 : redis.expire('vBrowserUIDLock:' + ((_a = room.vBrowser) === null || _a === void 0 ? void 0 : _a.creatorUID), 120));
                const expireTime = (0, time_1.getStartOfDay)() / 1000 + 86400;
                if ((_b = room.vBrowser) === null || _b === void 0 ? void 0 : _b.creatorClientID) {
                    yield (redis === null || redis === void 0 ? void 0 : redis.zincrby('vBrowserClientIDMinutes', 1, room.vBrowser.creatorClientID));
                    yield (redis === null || redis === void 0 ? void 0 : redis.expireat('vBrowserClientIDMinutes', expireTime));
                }
                if ((_c = room.vBrowser) === null || _c === void 0 ? void 0 : _c.creatorUID) {
                    yield (redis === null || redis === void 0 ? void 0 : redis.zincrby('vBrowserUIDMinutes', 1, (_d = room.vBrowser) === null || _d === void 0 ? void 0 : _d.creatorUID));
                    yield (redis === null || redis === void 0 ? void 0 : redis.expireat('vBrowserUIDMinutes', expireTime));
                }
            }
        }
    });
}
function freeUnusedRooms() {
    return __awaiter(this, void 0, void 0, function* () {
        // Clean up rooms that are no longer persisted and empty
        // Frees up some JS memory space when process is long-running
        const persistedRooms = yield getAllRooms();
        const persistedSet = new Set(persistedRooms.map((room) => room.roomId));
        rooms.forEach((room, key) => __awaiter(this, void 0, void 0, function* () {
            if (room.roster.length === 0) {
                if (!persistedSet.has(room.roomId)) {
                    room.destroy();
                    rooms.delete(key);
                }
            }
        }));
    });
}
function getAllRooms() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!postgres) {
            return [];
        }
        let range = '/%';
        if (config_1.default.SHARD) {
            const numShards = ecosystem_config_1.default.apps.filter((app) => { var _a; return (_a = app.env) === null || _a === void 0 ? void 0 : _a.SHARD; }).length;
            const selection = [];
            for (let i = 97; i < 123; i++) {
                const letterShard = (i % numShards) + 1;
                if (letterShard === Number(config_1.default.SHARD)) {
                    selection.push(String.fromCharCode(i));
                }
            }
            range = `/(${selection.join('|')})%`;
        }
        console.log(config_1.default.SHARD);
        console.log(range);
        return (yield postgres.query(`SELECT * from room where "roomId" SIMILAR TO '${range}'`)).rows;
    });
}
function getStats() {
    var _a, _b, _c, _d, _e, _f;
    return __awaiter(this, void 0, void 0, function* () {
        // Per-shard data is prefixed with "current"
        const now = Number(new Date());
        let currentUsers = 0;
        let currentHttp = 0;
        let currentVBrowser = 0;
        let currentVBrowserLarge = 0;
        let currentScreenShare = 0;
        let currentFileShare = 0;
        let currentVideoChat = 0;
        let currentRoomSizeCounts = {};
        let currentVBrowserUIDCounts = {};
        let currentRoomCount = rooms.size;
        rooms.forEach((room) => {
            var _a, _b, _c;
            const obj = {
                video: room.video,
                rosterLength: room.roster.length,
                videoChats: room.roster.filter((p) => p.isVideoChat).length,
                vBrowser: room.vBrowser,
            };
            currentUsers += obj.rosterLength;
            currentVideoChat += obj.videoChats;
            if (obj.vBrowser) {
                currentVBrowser += 1;
            }
            if (obj.vBrowser && obj.vBrowser.large) {
                currentVBrowserLarge += 1;
            }
            if (((_a = obj.video) === null || _a === void 0 ? void 0 : _a.startsWith('http')) && obj.rosterLength) {
                currentHttp += 1;
            }
            if (((_b = obj.video) === null || _b === void 0 ? void 0 : _b.startsWith('screenshare://')) && obj.rosterLength) {
                currentScreenShare += 1;
            }
            if (((_c = obj.video) === null || _c === void 0 ? void 0 : _c.startsWith('fileshare://')) && obj.rosterLength) {
                currentFileShare += 1;
            }
            if (obj.rosterLength > 0) {
                if (!currentRoomSizeCounts[obj.rosterLength]) {
                    currentRoomSizeCounts[obj.rosterLength] = 0;
                }
                currentRoomSizeCounts[obj.rosterLength] += 1;
            }
            if (obj.vBrowser && obj.vBrowser.creatorUID) {
                if (!currentVBrowserUIDCounts[obj.vBrowser.creatorUID]) {
                    currentVBrowserUIDCounts[obj.vBrowser.creatorUID] = 0;
                }
                currentVBrowserUIDCounts[obj.vBrowser.creatorUID] += 1;
            }
        });
        currentVBrowserUIDCounts = Object.fromEntries(Object.entries(currentVBrowserUIDCounts).filter(([, val]) => val > 1));
        const dbRoomData = (_a = (yield (postgres === null || postgres === void 0 ? void 0 : postgres.query(`SELECT "roomId", "creationTime", "lastUpdateTime", vanity, "isSubRoom", "roomTitle", "roomDescription", "mediaPath", owner, password from room WHERE "lastUpdateTime" > NOW() - INTERVAL '7 day' ORDER BY "creationTime" DESC`)))) === null || _a === void 0 ? void 0 : _a.rows;
        const currentRoomData = dbRoomData === null || dbRoomData === void 0 ? void 0 : dbRoomData.map((dbRoom) => {
            var _a, _b;
            const room = rooms.get(dbRoom.roomId);
            if (!room) {
                return null;
            }
            const obj = {
                roomId: room.roomId,
                video: room.video || undefined,
                videoTS: room.videoTS || undefined,
                creationTime: dbRoom.creationTime || undefined,
                lastUpdateTime: dbRoom.lastUpdateTime || undefined,
                vanity: dbRoom.vanity || undefined,
                isSubRoom: dbRoom.isSubRoom || undefined,
                owner: dbRoom.owner || undefined,
                password: dbRoom.password || undefined,
                roomTitle: dbRoom.roomTitle || undefined,
                roomDescription: dbRoom.roomDescription || undefined,
                mediaPath: dbRoom.mediaPath || undefined,
                rosterLength: room.roster.length,
                roster: room.getRosterForStats(),
                vBrowser: room.vBrowser,
                vBrowserElapsed: ((_a = room.vBrowser) === null || _a === void 0 ? void 0 : _a.assignTime) && now - ((_b = room.vBrowser) === null || _b === void 0 ? void 0 : _b.assignTime),
                lock: room.lock || undefined,
                creator: room.creator || undefined,
            };
            if (obj.video || obj.rosterLength > 0) {
                return obj;
            }
            else {
                return null;
            }
        }).filter(Boolean);
        // Per-shard data that we want to see in an array
        const currentUptime = [Number(new Date()) - launchTime];
        const currentMemUsage = [process.memoryUsage().rss];
        // Singleton stats below (same for all shards so don't combine)
        let vBrowserWaiting = Number(yield (redis === null || redis === void 0 ? void 0 : redis.get('currentVBrowserWaiting')));
        const cpuUsage = os_1.default.loadavg();
        const redisUsage = Number((_c = (_b = (yield (redis === null || redis === void 0 ? void 0 : redis.info()))) === null || _b === void 0 ? void 0 : _b.split('\n').find((line) => line.startsWith('used_memory:'))) === null || _c === void 0 ? void 0 : _c.split(':')[1].trim());
        const postgresUsage = Number((_d = (yield (postgres === null || postgres === void 0 ? void 0 : postgres.query(`SELECT pg_database_size('postgres');`)))) === null || _d === void 0 ? void 0 : _d.rows[0].pg_database_size);
        const numPermaRooms = Number((_e = (yield (postgres === null || postgres === void 0 ? void 0 : postgres.query('SELECT count(1) from room WHERE owner IS NOT NULL')))) === null || _e === void 0 ? void 0 : _e.rows[0].count);
        const numSubs = Number((_f = (yield (postgres === null || postgres === void 0 ? void 0 : postgres.query('SELECT count(1) from subscriber')))) === null || _f === void 0 ? void 0 : _f.rows[0].count);
        const discordBotWatch = yield (0, redis_1.getRedisCountDay)('discordBotWatch');
        const createRoomErrors = yield (0, redis_1.getRedisCountDay)('createRoomError');
        const deleteAccounts = yield (0, redis_1.getRedisCountDay)('deleteAccount');
        const chatMessages = yield (0, redis_1.getRedisCountDay)('chatMessages');
        const addReactions = yield (0, redis_1.getRedisCountDay)('addReaction');
        const hetznerApiRemaining = Number(yield (redis === null || redis === void 0 ? void 0 : redis.get('hetznerApiRemaining')));
        const vBrowserStarts = yield (0, redis_1.getRedisCountDay)('vBrowserStarts');
        const vBrowserLaunches = yield (0, redis_1.getRedisCountDay)('vBrowserLaunches');
        const vBrowserFails = yield (0, redis_1.getRedisCountDay)('vBrowserFails');
        const vBrowserStagingFails = yield (0, redis_1.getRedisCountDay)('vBrowserStagingFails');
        const vBrowserStopTimeout = yield (0, redis_1.getRedisCountDay)('vBrowserTerminateTimeout');
        const vBrowserStopEmpty = yield (0, redis_1.getRedisCountDay)('vBrowserTerminateEmpty');
        const vBrowserStopManual = yield (0, redis_1.getRedisCountDay)('vBrowserTerminateManual');
        const recaptchaRejectsLowScore = yield (0, redis_1.getRedisCountDay)('recaptchaRejectsLowScore');
        const vBrowserStartMS = yield (redis === null || redis === void 0 ? void 0 : redis.lrange('vBrowserStartMS', 0, -1));
        const vBrowserStageRetries = yield (redis === null || redis === void 0 ? void 0 : redis.lrange('vBrowserStageRetries', 0, -1));
        const vBrowserStageFails = yield (redis === null || redis === void 0 ? void 0 : redis.lrange('vBrowserStageFails', 0, -1));
        const vBrowserSessionMS = yield (redis === null || redis === void 0 ? void 0 : redis.lrange('vBrowserSessionMS', 0, -1));
        // const vBrowserVMLifetime = await redis?.lrange('vBrowserVMLifetime', 0, -1);
        const recaptchaRejectsOther = yield (0, redis_1.getRedisCountDay)('recaptchaRejectsOther');
        const urlStarts = yield (0, redis_1.getRedisCountDay)('urlStarts');
        const playlistAdds = yield (0, redis_1.getRedisCountDay)('playlistAdds');
        const screenShareStarts = yield (0, redis_1.getRedisCountDay)('screenShareStarts');
        const fileShareStarts = yield (0, redis_1.getRedisCountDay)('fileShareStarts');
        const mediasoupStarts = yield (0, redis_1.getRedisCountDay)('mediasoupStarts');
        const videoChatStarts = yield (0, redis_1.getRedisCountDay)('videoChatStarts');
        const connectStarts = yield (0, redis_1.getRedisCountDay)('connectStarts');
        const connectStartsDistinct = yield (0, redis_1.getRedisCountDayDistinct)('connectStartsDistinct');
        const subUploads = yield (0, redis_1.getRedisCountDay)('subUploads');
        const subDownloadsOS = yield (0, redis_1.getRedisCountDay)('subDownloadsOS');
        const subSearchesOS = yield (0, redis_1.getRedisCountDay)('subSearchesOS');
        const youtubeSearch = yield (0, redis_1.getRedisCountDay)('youtubeSearch');
        const vBrowserClientIDs = yield (redis === null || redis === void 0 ? void 0 : redis.zrevrangebyscore('vBrowserClientIDs', '+inf', '0', 'WITHSCORES', 'LIMIT', 0, 20));
        const vBrowserUIDs = yield (redis === null || redis === void 0 ? void 0 : redis.zrevrangebyscore('vBrowserUIDs', '+inf', '0', 'WITHSCORES', 'LIMIT', 0, 20));
        const vBrowserClientIDMinutes = yield (redis === null || redis === void 0 ? void 0 : redis.zrevrangebyscore('vBrowserClientIDMinutes', '+inf', '0', 'WITHSCORES', 'LIMIT', 0, 20));
        const vBrowserUIDMinutes = yield (redis === null || redis === void 0 ? void 0 : redis.zrevrangebyscore('vBrowserUIDMinutes', '+inf', '0', 'WITHSCORES', 'LIMIT', 0, 20));
        const vBrowserClientIDsCard = yield (redis === null || redis === void 0 ? void 0 : redis.zcard('vBrowserClientIDs'));
        const vBrowserUIDsCard = yield (redis === null || redis === void 0 ? void 0 : redis.zcard('vBrowserUIDs'));
        let vmManagerStats = null;
        try {
            vmManagerStats = (yield axios_1.default.get('http://localhost:' + config_1.default.VMWORKER_PORT + '/stats')).data;
        }
        catch (e) {
            console.warn(e);
        }
        const createRoomPreloads = yield (0, redis_1.getRedisCountDay)('createRoomPreload');
        return {
            currentRoomCount,
            currentRoomSizeCounts,
            currentUsers,
            currentVBrowser,
            currentVBrowserLarge,
            currentHttp,
            currentScreenShare,
            currentFileShare,
            currentVideoChat,
            currentVBrowserUIDCounts,
            currentUptime,
            currentMemUsage,
            cpuUsage,
            redisUsage,
            postgresUsage,
            vBrowserWaiting,
            numPermaRooms,
            numSubs,
            discordBotWatch,
            createRoomErrors,
            createRoomPreloads,
            deleteAccounts,
            chatMessages,
            addReactions,
            urlStarts,
            playlistAdds,
            screenShareStarts,
            fileShareStarts,
            mediasoupStarts,
            subUploads,
            subDownloadsOS,
            subSearchesOS,
            youtubeSearch,
            videoChatStarts,
            connectStarts,
            connectStartsDistinct,
            hetznerApiRemaining,
            vBrowserStarts,
            vBrowserLaunches,
            vBrowserFails,
            vBrowserStagingFails,
            vBrowserStopManual,
            vBrowserStopEmpty,
            vBrowserStopTimeout,
            recaptchaRejectsLowScore,
            recaptchaRejectsOther,
            vmManagerStats,
            vBrowserStartMS,
            vBrowserStageRetries,
            vBrowserStageFails,
            vBrowserSessionMS,
            // vBrowserVMLifetime,
            vBrowserClientIDs,
            vBrowserClientIDsCard,
            vBrowserClientIDMinutes,
            vBrowserUIDs,
            vBrowserUIDsCard,
            vBrowserUIDMinutes,
            currentRoomData,
        };
    });
}
function computeOpenSubtitlesHash(first, last, size) {
    // console.log(first.length, last.length, size);
    let temp = BigInt(size);
    process(first);
    process(last);
    temp = temp & BigInt('0xffffffffffffffff');
    return temp.toString(16).padStart(16, '0');
    function process(chunk) {
        for (let i = 0; i < chunk.length; i += 8) {
            const long = chunk.readBigUInt64LE(i);
            temp += long;
        }
    }
}
