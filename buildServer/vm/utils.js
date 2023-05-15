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
exports.getSessionLimitSeconds = exports.getBgVMManagers = exports.getVMManagerConfig = exports.assignVM = exports.imageName = void 0;
const config_1 = __importDefault(require("../config"));
const scaleway_1 = require("./scaleway");
const hetzner_1 = require("./hetzner");
const digitalocean_1 = require("./digitalocean");
const docker_1 = require("./docker");
exports.imageName = 'howardc93/vbrowser';
const assignVM = (redis, vmManager) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assignStart = Number(new Date());
        let selected = null;
        while (!selected) {
            if (vmManager.getMinSize() === 0) {
                // This code spawns a VM if none is available in the pool
                const availableCount = yield redis.llen(vmManager.getRedisQueueKey());
                if (!availableCount) {
                    yield vmManager.startVMWrapper();
                }
            }
            let resp = yield redis.blpop(vmManager.getRedisQueueKey(), config_1.default.VM_ASSIGNMENT_TIMEOUT);
            if (!resp) {
                return undefined;
            }
            const id = resp[1];
            console.log('[ASSIGN]', id);
            const lock = yield redis.set('lock:' + vmManager.id + ':' + id, '1', 'EX', 300, 'NX');
            if (!lock) {
                console.log('failed to acquire lock on VM:', id);
                continue;
            }
            const cachedData = yield redis.get(vmManager.getRedisHostCacheKey() + ':' + id);
            let candidate = cachedData && cachedData.startsWith('{') && JSON.parse(cachedData);
            if (!candidate) {
                candidate = yield vmManager.getVM(id);
            }
            selected = candidate;
        }
        const assignEnd = Number(new Date());
        const assignElapsed = assignEnd - assignStart;
        yield redis.lpush('vBrowserStartMS', assignElapsed);
        yield redis.ltrim('vBrowserStartMS', 0, 24);
        console.log('[ASSIGN]', selected.id, assignElapsed + 'ms');
        const retVal = Object.assign(Object.assign({}, selected), { assignTime: Number(new Date()) });
        return retVal;
    }
    catch (e) {
        console.warn(e);
        return undefined;
    }
});
exports.assignVM = assignVM;
function createVMManager(poolConfig) {
    let vmManager = null;
    if (config_1.default.REDIS_URL &&
        config_1.default.SCW_SECRET_KEY &&
        config_1.default.SCW_ORGANIZATION_ID &&
        poolConfig.provider === 'Scaleway') {
        vmManager = new scaleway_1.Scaleway(poolConfig);
    }
    else if (config_1.default.REDIS_URL &&
        config_1.default.HETZNER_TOKEN &&
        poolConfig.provider === 'Hetzner') {
        vmManager = new hetzner_1.Hetzner(poolConfig);
    }
    else if (config_1.default.REDIS_URL &&
        config_1.default.DO_TOKEN &&
        poolConfig.provider === 'DO') {
        vmManager = new digitalocean_1.DigitalOcean(poolConfig);
    }
    else if (config_1.default.REDIS_URL &&
        config_1.default.DOCKER_VM_HOST &&
        poolConfig.provider === 'Docker') {
        vmManager = new docker_1.Docker(poolConfig);
    }
    return vmManager;
}
function getVMManagerConfig() {
    return config_1.default.VM_MANAGER_CONFIG.split(',').map((c) => {
        const split = c.split(':');
        return {
            provider: split[0],
            isLarge: split[1] === 'large',
            region: split[2],
            minSize: Number(split[3]),
            limitSize: Number(split[4]),
        };
    });
}
exports.getVMManagerConfig = getVMManagerConfig;
function getBgVMManagers() {
    const result = {};
    const conf = getVMManagerConfig();
    conf.forEach((c) => {
        const mgr = createVMManager(c);
        if (mgr) {
            result[mgr.getPoolName()] = mgr;
        }
    });
    return result;
}
exports.getBgVMManagers = getBgVMManagers;
function getSessionLimitSeconds(isLarge) {
    return isLarge
        ? config_1.default.VBROWSER_SESSION_SECONDS_LARGE
        : config_1.default.VBROWSER_SESSION_SECONDS;
}
exports.getSessionLimitSeconds = getSessionLimitSeconds;
