const fs = require('fs');
const path = require('path');
const { M } = require('./i18n');

/**
 * 微软正版账户登录（和 PCL / HMCL 同样的授权码流程 + 内嵌浏览器窗口）
 *
 * 流程：
 *   1. 弹出内嵌窗口让用户登录微软账号，截获重定向里的 code
 *   2. code -> MSA access_token / refresh_token
 *   3. MSA token -> Xbox Live (XBL) token
 *   4. XBL token -> XSTS token
 *   5. XSTS token -> Minecraft access_token
 *   6. 查游戏档案拿 UUID / 玩家名
 */

const DEFAULT_CLIENT_ID = '00000000402b5328';
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const SCOPE = 'XboxLive.signin offline_access';

const AUTHORIZE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const TOKEN_URLS = [
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  'https://login.live.com/oauth20_token.srf',
];

const UA = 'MCToolbox/1.0.0';

function buildAuthorizeUrl(clientId, state) {
  const p = new URLSearchParams({
    client_id: clientId || DEFAULT_CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
    prompt: 'select_account',
    state: state || 'mctoolbox',
  });
  return AUTHORIZE_URL + '?' + p.toString();
}

/** 弹出内嵌浏览器窗口登录，返回 { code } */
function interactiveLogin(parentWin, opts) {
  opts = opts || {};
  const clientId = opts.clientId || DEFAULT_CLIENT_ID;
  const state = 'mc' + Math.random().toString(36).slice(2);
  const url = buildAuthorizeUrl(clientId, state);

  return new Promise((resolve, reject) => {
    let BrowserWindow;
    try {
      BrowserWindow = require('electron').BrowserWindow;
    } catch (e) {
      return reject(new Error(M('当前环境没有 Electron，无法弹出登录窗口', 'Electron is not available in this environment, so the login window cannot be opened')));
    }

    const authWin = new BrowserWindow({
      width: 540,
      height: 760,
      title: M('登录微软账户（Minecraft 正版）', 'Sign in to a Microsoft account (Minecraft premium)'),
      parent: parentWin || undefined,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:mctoolbox-msa',
      },
    });

    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      try {
        authWin.destroy();
      } catch (e) {
        /* ignore */
      }
      fn(arg);
    };

    const inspectUrl = (navUrl) => {
      if (!navUrl || typeof navUrl !== 'string') return;
      if (!navUrl.startsWith(REDIRECT_URI)) return;
      let u;
      try {
        u = new URL(navUrl);
      } catch (e) {
        return;
      }
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      if (code) {
        done(resolve, { code, state, clientId });
      } else {
        done(
          reject,
          new Error(
            M('登录未完成：', 'Login was not completed: ') +
              (u.searchParams.get('error_description') || err || M('没有拿到授权码', 'no authorization code was received'))
          )
        );
      }
    };

    authWin.webContents.on('will-redirect', (e, u) => inspectUrl(u));
    authWin.webContents.on('did-redirect-navigation', (e, u) => inspectUrl(u));
    authWin.webContents.on('did-navigate', (e, u) => inspectUrl(u));
    authWin.webContents.on('did-navigate-in-page', (e, u) => inspectUrl(u));

    authWin.on('closed', () => {
      done(reject, new Error(M('登录窗口被关闭了（如果是不小心关的，重新点一次登录即可）', 'The login window was closed (if that was an accident, just click sign in again)')));
    });

    authWin.loadURL(url).catch((e) => done(reject, e));
  });
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  let j = null;
  try {
    j = await res.json();
  } catch (e) {
    j = null;
  }
  return { ok: res.ok, status: res.status, json: j || {} };
}

/** 用授权码换令牌（两个端点都试一遍，兼容 converged / live 两种） */
async function exchangeCode(clientId, code) {
  let last = M('未知错误', 'Unknown error');
  for (const url of TOKEN_URLS) {
    try {
      const r = await postForm(url, {
        client_id: clientId,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
      });
      if (r.json.access_token) return r.json;
      last = r.json.error_description || r.json.error || 'HTTP ' + r.status;
    } catch (e) {
      last = e.message;
    }
  }
  throw new Error(M('换取访问令牌失败：', 'Failed to exchange the authorization code for an access token: ') + String(last).slice(0, 240));
}

/** 用 refresh_token 续期（下次打开不用重新登录） */
async function refresh(clientId, refreshToken) {
  let last = M('未知错误', 'Unknown error');
  for (const url of TOKEN_URLS) {
    try {
      const r = await postForm(url, {
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
      });
      if (r.json.access_token) return r.json;
      last = r.json.error_description || r.json.error || 'HTTP ' + r.status;
    } catch (e) {
      last = e.message;
    }
  }
  throw new Error(M('登录已过期且续期失败：', 'The login has expired and renewal failed: ') + String(last).slice(0, 200));
}

async function postJson(url, body, extraHeaders) {
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, extraHeaders || {}),
    body: JSON.stringify(body),
  });
  let j = null;
  try {
    j = await res.json();
  } catch (e) {
    j = null;
  }
  return { ok: res.ok, status: res.status, json: j || {} };
}

async function xblAuthenticate(msaAccessToken) {
  const r = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: 'd=' + msaAccessToken,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const j = r.json;
  if (!j.Token) {
    throw new Error(M('Xbox Live 认证失败：', 'Xbox Live authentication failed: ') + JSON.stringify(j).slice(0, 220));
  }
  const xui = (j.DisplayClaims && j.DisplayClaims.xui && j.DisplayClaims.xui[0]) || {};
  return { token: j.Token, uhs: xui.uhs };
}

const XSTS_ERRORS = {
  2148916227: M('这个微软账号已被 Xbox Live 封禁。', 'This Microsoft account has been banned by Xbox Live.'),
  2148916233: M('这个微软账号还没有 Xbox 账户。请先用同一个账号登录一次 xbox.com 创建（免费），再回来登录。', 'This Microsoft account does not have an Xbox account yet. Sign in once at xbox.com with the same account to create one (free), then come back and sign in.'),
  2148916235: M('Xbox Live 在你所在的国家/地区不可用（需要能正常访问 Xbox 服务的网络环境）。', 'Xbox Live is not available in your country/region (you need a network environment that can reach Xbox services).'),
  2148916236: M('这个账号需要先完成年龄验证。', 'This account must complete age verification first.'),
  2148916237: M('这个账号需要先完成年龄验证。', 'This account must complete age verification first.'),
  2148916238: M('这是未成年账号，需要家长在 Microsoft 家庭安全里把它加入家庭组后才能登录。', 'This is a minor account; a parent must add it to a family group in Microsoft Family Safety before it can sign in.'),
};

async function xstsAuthorize(xblToken) {
  const r = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  const j = r.json;
  if (!j.Token) {
    const code = j.XErr;
    throw new Error((code && XSTS_ERRORS[code]) || M('XSTS 授权失败：', 'XSTS authorization failed: ') + (j.Message || JSON.stringify(j).slice(0, 220)));
  }
  const xui = (j.DisplayClaims && j.DisplayClaims.xui && j.DisplayClaims.xui[0]) || {};
  return { token: j.Token, uhs: xui.uhs, xuid: xui.xid };
}

async function loginMinecraft(xstsToken, uhs) {
  const r = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: 'XBL3.0 x=' + uhs + ';' + xstsToken,
  });
  const j = r.json;
  if (!j.access_token) {
    throw new Error(M('Minecraft 登录失败：', 'Minecraft login failed: ') + JSON.stringify(j).slice(0, 220));
  }
  return { accessToken: j.access_token, expiresIn: j.expires_in };
}

async function getProfile(mcAccessToken) {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + mcAccessToken, Accept: 'application/json' },
  });
  if (res.status === 404) {
    throw new Error(M('这个微软账号还没有购买 Minecraft Java 版（找不到游戏档案）。', 'This Microsoft account does not own Minecraft Java Edition (no game profile found).'));
  }
  if (res.status === 401) {
    throw new Error(M('访问令牌无效或已过期，请重新登录。', 'The access token is invalid or has expired - please sign in again.'));
  }
  if (!res.ok) {
    throw new Error(M('获取游戏档案失败 HTTP ', 'Failed to fetch the game profile HTTP ') + res.status);
  }
  const j = await res.json();
  return { id: j.id, name: j.name, skins: j.skins || [], capes: j.capes || [] };
}

/** 用 MSA 令牌走完整条链路，拿到可直接启动游戏的一整套凭据 */
async function authenticateWithMsaToken(msaAccessToken, refreshToken, clientId, onStatus) {
  const say = (s) => {
    if (onStatus) onStatus(s);
  };

  say(M('正在认证 Xbox Live…', 'Authenticating with Xbox Live…'));
  const xbl = await xblAuthenticate(msaAccessToken);

  say(M('正在获取 XSTS 授权…', 'Requesting XSTS authorization…'));
  const xsts = await xstsAuthorize(xbl.token);

  say(M('正在登录 Minecraft 服务…', 'Signing in to Minecraft services…'));
  const mc = await loginMinecraft(xsts.token, xsts.uhs);

  say(M('正在读取游戏档案…', 'Reading the game profile…'));
  const profile = await getProfile(mc.accessToken);

  return {
    type: 'msa',
    clientId: clientId || DEFAULT_CLIENT_ID,
    name: profile.name,
    uuid: profile.id,
    accessToken: mc.accessToken,
    xuid: xsts.xuid || xsts.uhs,
    userType: 'msa',
    msaRefreshToken: refreshToken || null,
    obtainedAt: Date.now(),
    expiresIn: mc.expiresIn || null,
    skins: profile.skins,
  };
}

/** 完整登录：弹窗拿 code -> 一路换到游戏凭据 */
async function login(parentWin, opts) {
  opts = opts || {};
  const clientId = opts.clientId || DEFAULT_CLIENT_ID;
  const { code } = await interactiveLogin(parentWin, { clientId });
  if (opts.onStatus) opts.onStatus(M('正在换取微软令牌…', 'Exchanging the Microsoft token…'));
  const tokens = await exchangeCode(clientId, code);
  return authenticateWithMsaToken(tokens.access_token, tokens.refresh_token, clientId, opts.onStatus);
}

/** 用保存的 refresh_token 静默续期 */
async function loginSilently(account, opts) {
  opts = opts || {};
  if (!account || !account.msaRefreshToken) throw new Error(M('没有可续期的登录信息', 'No saved login information to renew'));
  const clientId = account.clientId || DEFAULT_CLIENT_ID;
  if (opts.onStatus) opts.onStatus(M('正在续期登录…', 'Renewing the login…'));
  const tokens = await refresh(clientId, account.msaRefreshToken);
  return authenticateWithMsaToken(tokens.access_token, tokens.refresh_token, clientId, opts.onStatus);
}

module.exports = {
  DEFAULT_CLIENT_ID,
  REDIRECT_URI,
  buildAuthorizeUrl,
  interactiveLogin,
  exchangeCode,
  refresh,
  xblAuthenticate,
  xstsAuthorize,
  loginMinecraft,
  getProfile,
  authenticateWithMsaToken,
  login,
  loginSilently,
};
