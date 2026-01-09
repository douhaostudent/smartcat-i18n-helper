const https = require('https');
const fs  = require('fs');
const PROJECTID_OPTIONS = {
  "zh-Hans":"f2415fe0-3af5-4700-909a-b823622841b9",
  "en":"f2415fe0-3af5-4700-909a-b823622841b9",
  "pt-BR":"77f61328-394f-448f-9fb8-cb099c7937bb",
  "ja":"77f61328-394f-448f-9fb8-cb099c7937bb",
  "de":"77f61328-394f-448f-9fb8-cb099c7937bb",
  "es-MX":"77f61328-394f-448f-9fb8-cb099c7937bb",
  "ko":"77f61328-394f-448f-9fb8-cb099c7937bb",
  "th":"f2415fe0-3af5-4700-909a-b823622841b9"
};


/**
 * 显示错误信息
 */
function showError(message) {
  vscode.window.showErrorMessage(message);
}

/**
 * 获取授权Header
 */
function getAuthorization() {
  return `Basic ${Buffer.from('c518c8a5-4ddd-4fad-81a8-b63687308427:40_LmGxTD30izpU7fSRrOrSD6ApO', 'utf-8').toString('base64')}`;
}

/**
 * 获取任务ID
 */
function getTaskId(lang) {
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
          resolve(parsedData);
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

function getLanguageResult(taskId, lang) {
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
            try {
              const result = JSON.parse(data);
              resolve(result);
              
            } catch (error) {
              showError(`解析翻译结果出错：${error}`);
              reject(error);
            }
          });
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      }
    );

    request.on('error', (error) => {
      showError('翻译出错，请稍后重试。');
      console.log(error, "smartcat 翻译错误");
      reject(error);
    });
  });
}

async function initExport(lang, localLang) {
  try {
    const taskId = await getTaskId(lang);
    const translatesRes = await getLanguageResult(taskId, lang);
    // const formatKeyTranslates = {};
    // Object.keys(translatesRes).forEach(key => {
    //   const newKey = key.replaceAll('.', '_'); // 替换所有 . 为 _
    //   formatKeyTranslates[newKey] = translatesRes[key];
    // });
    // fs.writeFile(localLang,translatesRes,'utf-8');
    return { langType: localLang, result:translatesRes };
  } catch (error) {
    console.log('init error', error);
    throw error;
  }
}

/**
 * 主函数 - 翻译所有语言
 */
async function translateSmartcatLocaleAll() {
  try {
    const getSmartLangTypeMap = {
      "en":"en",
      "pt":"pt-BR",
      "zh":"zh-Hans",
      "ja":"ja",
      "de":"de",
      "es":"es-MX",
      "kor":"ko",
      "th":"th"
    };

    const promises = Object.keys(getSmartLangTypeMap).map((key) => 
      initExport(getSmartLangTypeMap[key], key)
    );
    const result = await Promise.all(promises);
    console.log('smartcat翻译拉取成功！');
    return result;
  } catch (error) {
    console.log('smartcat拉取翻译失败', error);
    return [];
  }
}




translateSmartcatLocaleAll();