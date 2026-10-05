/**
 * 主进程侧的文案多语言：M('中文', 'English')
 * 语言由渲染进程通过 settings:set 同步过来。
 */

let lang = 'zh';

function setLang(l) {
  lang = l === 'en' ? 'en' : 'zh';
  return lang;
}

function getLang() {
  return lang;
}

/** 中文 / English 二选一 */
function M(zh, en) {
  return lang === 'en' && en ? en : zh;
}

module.exports = { setLang, getLang, M };
