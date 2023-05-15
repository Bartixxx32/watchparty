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
exports.getVideoDuration = exports.fetchYoutubeVideo = exports.getYoutubeVideoID = exports.searchYoutube = exports.mapYoutubeListResult = exports.mapYoutubeSearchResult = void 0;
const config_1 = __importDefault(require("../config"));
const regex_1 = require("./regex");
const youtube_1 = require("@googleapis/youtube");
let Youtube = config_1.default.YOUTUBE_API_KEY
    ? (0, youtube_1.youtube)({
        version: 'v3',
        auth: config_1.default.YOUTUBE_API_KEY,
    })
    : null;
const mapYoutubeSearchResult = (video) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    return {
        channel: (_b = (_a = video.snippet) === null || _a === void 0 ? void 0 : _a.channelTitle) !== null && _b !== void 0 ? _b : '',
        url: 'https://www.youtube.com/watch?v=' + ((_c = video === null || video === void 0 ? void 0 : video.id) === null || _c === void 0 ? void 0 : _c.videoId),
        name: (_e = (_d = video.snippet) === null || _d === void 0 ? void 0 : _d.title) !== null && _e !== void 0 ? _e : '',
        img: (_j = (_h = (_g = (_f = video.snippet) === null || _f === void 0 ? void 0 : _f.thumbnails) === null || _g === void 0 ? void 0 : _g.default) === null || _h === void 0 ? void 0 : _h.url) !== null && _j !== void 0 ? _j : '',
        duration: 0,
        type: 'youtube',
    };
};
exports.mapYoutubeSearchResult = mapYoutubeSearchResult;
const mapYoutubeListResult = (video) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const videoId = video.id;
    return {
        url: 'https://www.youtube.com/watch?v=' + videoId,
        name: (_b = (_a = video.snippet) === null || _a === void 0 ? void 0 : _a.title) !== null && _b !== void 0 ? _b : '',
        img: (_f = (_e = (_d = (_c = video.snippet) === null || _c === void 0 ? void 0 : _c.thumbnails) === null || _d === void 0 ? void 0 : _d.default) === null || _e === void 0 ? void 0 : _e.url) !== null && _f !== void 0 ? _f : '',
        channel: (_h = (_g = video.snippet) === null || _g === void 0 ? void 0 : _g.channelTitle) !== null && _h !== void 0 ? _h : '',
        duration: (0, exports.getVideoDuration)((_k = (_j = video.contentDetails) === null || _j === void 0 ? void 0 : _j.duration) !== null && _k !== void 0 ? _k : ''),
        type: 'youtube',
    };
};
exports.mapYoutubeListResult = mapYoutubeListResult;
const searchYoutube = (query) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const response = yield (Youtube === null || Youtube === void 0 ? void 0 : Youtube.search.list({
        part: ['snippet'],
        type: ['video'],
        maxResults: 25,
        q: query,
    }));
    return (_c = (_b = (_a = response === null || response === void 0 ? void 0 : response.data) === null || _a === void 0 ? void 0 : _a.items) === null || _b === void 0 ? void 0 : _b.map(exports.mapYoutubeSearchResult)) !== null && _c !== void 0 ? _c : [];
});
exports.searchYoutube = searchYoutube;
const getYoutubeVideoID = (url) => {
    const idParts = regex_1.YOUTUBE_VIDEO_ID_REGEX.exec(url);
    if (!idParts) {
        return;
    }
    const id = idParts[1];
    if (!id) {
        return;
    }
    return id;
};
exports.getYoutubeVideoID = getYoutubeVideoID;
const fetchYoutubeVideo = (id) => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e;
    const response = yield (Youtube === null || Youtube === void 0 ? void 0 : Youtube.videos.list({
        part: ['snippet', 'contentDetails'],
        id: [id],
    }));
    const top = (_e = (_d = response === null || response === void 0 ? void 0 : response.data) === null || _d === void 0 ? void 0 : _d.items) === null || _e === void 0 ? void 0 : _e[0];
    return top ? (0, exports.mapYoutubeListResult)(top) : null;
});
exports.fetchYoutubeVideo = fetchYoutubeVideo;
const getVideoDuration = (string) => {
    if (!string) {
        return 0;
    }
    const hoursParts = regex_1.PT_HOURS_REGEX.exec(string);
    const minutesParts = regex_1.PT_MINUTES_REGEX.exec(string);
    const secondsParts = regex_1.PT_SECONDS_REGEX.exec(string);
    const hours = hoursParts ? parseInt(hoursParts[1]) : 0;
    const minutes = minutesParts ? parseInt(minutesParts[1]) : 0;
    const seconds = secondsParts ? parseInt(secondsParts[1]) : 0;
    const totalSeconds = seconds + minutes * 60 + hours * 60 * 60;
    return totalSeconds;
};
exports.getVideoDuration = getVideoDuration;
