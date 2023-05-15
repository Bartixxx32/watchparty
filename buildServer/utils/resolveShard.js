"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveShard = void 0;
const ecosystem_config_1 = __importDefault(require("../ecosystem.config"));
function resolveShard(roomId) {
    const numShards = ecosystem_config_1.default.apps.filter((app) => { var _a; return (_a = app.env) === null || _a === void 0 ? void 0 : _a.SHARD; }).length;
    const letter = roomId[0];
    const charCode = letter.charCodeAt(0);
    return Number((charCode % numShards) + 1);
}
exports.resolveShard = resolveShard;
