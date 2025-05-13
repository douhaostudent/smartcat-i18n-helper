import * as vscode from 'vscode';
import { window } from 'vscode';
import * as https from 'https';
import { showError } from './editCode';
const langMap = {
  en: 'en-us',
  ja: 'ja-jp',
  ko: 'ko-kr',
  th: 'th-th',
  'zh-Hans': 'zh-Hans', // 基准中文映射
  'zh-Hant-TW': 'zh-tw', // 此处台湾的语言需要映射三种  'zh-hk', 'zh-mo'
  'pt-BR': 'pt-br',
  'es-MX': 'es-mx',
};

const PROJECTID_OPTIONS = {
  ko: '19ff92e7-ae7e-4c7e-9f91-2b989e57b5a3',
  ja: '19ff92e7-ae7e-4c7e-9f91-2b989e57b5a3',
  'pt-BR': '19ff92e7-ae7e-4c7e-9f91-2b989e57b5a3',
  'es-MX': '19ff92e7-ae7e-4c7e-9f91-2b989e57b5a3',
  en: '0fc74855-c4e3-4ab5-91a2-9ec9ffb46d94',
  th: '0fc74855-c4e3-4ab5-91a2-9ec9ffb46d94',
  'zh-Hant-TW': '0fc74855-c4e3-4ab5-91a2-9ec9ffb46d94',
  'zh-Hans': '0fc74855-c4e3-4ab5-91a2-9ec9ffb46d94',
};
const WORKSPACE = 'c518c8a5-4ddd-4fad-81a8-b63687308427';
const APITOKEN = '33_hT9imd7M4JRMtCWBQzfLpBnQZ';

/**
 * 获取授权Header
 * @return {*}
 */
function getAuthorization() {
  const buffer = Buffer.from(`${WORKSPACE}:${APITOKEN}`);
  const base64Str = buffer.toString('base64');
  return `Basic ${base64Str}`;
}

type Lang = 'ko' | 'ja'|'pt-BR' | 'es-MX'|'en' | 'th' |'zh-Hant-TW' | 'zh-Hans' 

/**
 * 获取任务ID
 * @param {*} lang
 * @return {*}
 */

function getTaskId(lang:Lang):Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`获取${lang}的taskId中...`);
    const projectId = PROJECTID_OPTIONS[lang];
    const options = {
      hostname: 'smartcat.com',
      path: `/api/integration/v2/project/${projectId}/export?languages=${lang}`,
      method: 'POST',
      headers: {
        Authorization: getAuthorization(),
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          console.log(`taskId获取成功：${parsedData}`);
          resolve(parsedData) ;
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });
    req.end();
  });
}

function getLanguageResult(taskId:string, lang:Lang):Promise<{[k:string]:any}> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      `https://smartcat.com/api/integration/v1/document/export/${taskId}`,
      {
        headers: {
          Authorization: getAuthorization(),
        },
      },
      (res) => {
        // 204 表示下载中，需要轮询
        if (res.statusCode === 204) {
          console.log(`下载${lang}中...`);
          setTimeout(() => {
            getLanguageResult(taskId, lang).then(resolve).catch(reject);
          }, 3000);
          return;
        }

        // 200 表示下载完成
        if (res.statusCode === 200) {
          console.log(`smartcat翻译成功：${lang}`);
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            const result = JSON.parse(data);
            resolve(result);
            if (result.error_code) {
              showError(`翻译出错：${result.error_msg}`);
              reject();
            }

          });
        }
      }
    );

    request.on('error', (error) => {
      showError('翻译出错，请稍后重试。');
      console.log(error, "smartcat 翻译错误");
      reject();
    });
    request.end();
  });
}

async function initExport(lang:Lang,localLang:string) {
  try {
    const taskId = await getTaskId(lang);
    const translatesRes = await getLanguageResult(taskId, lang);
    const formatKeyTranslates:{[key:string]:any} = {};
    Object.keys(translatesRes).forEach(key => {
      const newKey = key.replaceAll('.', '_'); // 替换所有 . 为 _
      formatKeyTranslates[newKey] = translatesRes[key];
    });
    //  文件名映射
    return  { langType:localLang,result: formatKeyTranslates};
  } catch (error) {
    console.log('init error', error);
  }
}


//    翻译文件的langType
export default async function  translateSmartcatLocaleAll() {
  try {
      const  getSmartLangTypeMap:any = {
      'en-us':'en',
      'ja-jp':'ja',
      'ko-kr':'ko',
      'th-th':'th',
      'zh-Hans':'zh-Hans', // 基准中文映射
      'zh-tw': 'zh-Hant-TW',// 此处台湾的语言需要映射三种  'zh-hk', 'zh-mo'
      'zh-hk':'zh-Hant-TW',
      'zh-mo':'zh-Hant-TW',
      'pt-br': 'pt-BR',
      'es-mx':'es-MX',
    };

    const promises = Object.keys(getSmartLangTypeMap).map((key)=> initExport(getSmartLangTypeMap[key],key));
    const result  = await Promise.all(promises);
    return result;
  } catch (error) {
    
    window.showWarningMessage('smartcat拉取翻译失败,请重试');
    console.log('smartcat拉取翻译失败', error);
  }
}
// 本地调试需要把export es语法移除
// translateSmartcatLocale();
