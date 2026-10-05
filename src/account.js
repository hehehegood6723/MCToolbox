const fs = require('fs');
const path = require('path');
const { M } = require('./i18n');

/** 正版登录信息本地保存（refresh token 用系统加密 API 加密后再落盘） */

function storePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'mctool-account.json');
}

function encrypt(text) {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) {
      return { enc: true, data: safeStorage.encryptString(text).toString('base64') };
    }
  } catch (e) {
    /* ignore */
  }
  return { enc: false, data: Buffer.from(String(text), 'utf8').toString('base64') };
}

function decrypt(obj) {
  if (!obj || !obj.data) return null;
  try {
    if (obj.enc) {
      const { safeStorage } = require('electron');
      return safeStorage.decryptString(Buffer.from(obj.data, 'base64'));
    }
    return Buffer.from(obj.data, 'base64').toString('utf8');
  } catch (e) {
    return null;
  }
}

function save(account) {
  const out = Object.assign({}, account);
  if (out.msaRefreshToken) {
    out.refresh = encrypt(out.msaRefreshToken);
    delete out.msaRefreshToken;
  }
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(out, null, 2), 'utf8');
  return out;
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(storePath(), 'utf8').replace(/^\uFEFF/, ''));
    return Object.assign({}, j, { msaRefreshToken: decrypt(j.refresh) });
  } catch (e) {
    return null;
  }
}

function clear() {
  try {
    fs.unlinkSync(storePath());
  } catch (e) {
    /* ignore */
  }
  return true;
}

/** 给界面看的版本（不带任何令牌） */
function publicView(a) {
  if (!a) return null;
  return {
    type: a.type || 'msa',
    name: a.name,
    uuid: a.uuid,
    xuid: a.xuid || null,
    obtainedAt: a.obtainedAt || null,
    expiresIn: a.expiresIn || null,
    skin: (a.skins && a.skins[0] && a.skins[0].url) || null,
  };
}

module.exports = { save, load, clear, publicView, storePath };
