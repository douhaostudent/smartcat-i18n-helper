import { window } from 'vscode';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generator from '@babel/generator';

import * as t from '@babel/types';
import * as prettier from 'prettier';
import * as fs from 'fs';
import * as path from 'path';

import BaseI18nHelper from './index';
import { Words } from './interface';

export const saveToLocalFile = (
  data: Words[],
  instance: BaseI18nHelper,
) => {
  if (!instance.currentTextDocumentFileUri) {
    return;
  }

  if (!fs.existsSync(instance.currentTextDocumentFileUri.fsPath)) {
    window.showErrorMessage('文件已被删除');
    return;
  }

  if (!instance.projectRootPath || !instance.localesFullPath) {
    return;
  }

  if (!fs.existsSync(instance.localesFullPath)) {
    fs.mkdirSync(instance.localesFullPath);
    window.showWarningMessage(`${instance.localesFullPath}文件夹不存在，已为您自动生成。`);
  }

  instance.languages.forEach(lang => {

    const fullFilePath = path.join(instance.localesFullPath!, `./${lang.localeFileName}.${instance.fileType}`);
    if (!fs.existsSync(fullFilePath)) {
      window.showWarningMessage(`${lang.localeFileName}文件不存在，已为您自动生成。`);
      fs.writeFileSync(fullFilePath, 'export default {}');
    }

    const newWords = data.reduce((prev: { key: string, value: string }[], item: any) => {
      if (!item[lang.langType]?.exists && !prev.some(o => o.key === item.key)) {
        prev.push({
          key: item.key,
          value: item[lang.langType]?.value,
        });
      }
      return prev;
    }, []);

    const fileContent = fs.readFileSync(fullFilePath).toString();

    const ast = parse(fileContent, { sourceType: "module" });

    const visitor: any = {
       
      ObjectExpression(nodePath: any) {
        const { node } = nodePath;

        node.properties.push(
          ...newWords.map((word) => {
            return t.objectProperty(
              t.stringLiteral(word.key),
              t.stringLiteral(word.value),
            );
          })
        );
      },
    };

    traverse(ast, visitor);

    const newContent = generator(ast, {
      jsescOption: { minimal: true },
    }).code;

    const formatted = prettier.format(
      newContent,
      {
        parser: 'babel',
        trailingComma: 'all',
      }
    );

    // if (formatted) {
    // //   fs.writeFileSync(fullFilePath, formatted);
    // }
  });
};






export const getValue = (
  words: any,
  instance: BaseI18nHelper,
) => {
  const { key, value, rawValue, isJsxAttr, isJsxText, isTemplate, isTranslated= false } = words;
  if (isTemplate) {
    return `\${${instance.methodName}("${key}" /* ${value} */)}`;
  }

  if (!isJsxAttr) {
    return `${instance.methodName}("${key}" /* ${value} */)`;
  }

  if (isJsxText) {
    return rawValue.replace(value, `{${instance.methodName}("${key}" /* ${value} */)}`);
  }

  return `{${instance.methodName}("${key}" /* ${value} */)}`;
};

export const replaceKey = (
  words: any,
) => {
  const { key, value, rawValue, isJsxAttr, isJsxText, isTemplate } = words;
  if (isTemplate) {
    return `\${"${key}" /* ${value} */}`;
  }

  if (!isJsxAttr) {
    return `"${key}" /* ${value} */`;
  }

  if (isJsxText) {
    return rawValue.replace(value, `{"${key}" /* ${value} */}`);
  }

  return `{"${key}" /* ${value} */}`;
};





export const getLocalWordsByFileName = (
  fileName: string,
  defaultLang: boolean,
  instance: BaseI18nHelper,
) => {

  const words: any = {};

  if (!instance.projectRootPath || !instance.localesFullPath) {
    return words;
  }

  const filePath = path.join(instance.localesFullPath, `./${fileName}.${instance.fileType}`);

  if (!fs.existsSync(filePath)) {
    return words;
  }

  const fileContent = fs.readFileSync(filePath).toString();
  //@babel/parser 可以间接解析 JSON 文件，但需要将 JSON 转换为 JavaScript 代码后再处理。 
  // 读取 JSON 文件并包装为 JS 代码
// const jsonContent = fs.readFileSync('data.json', 'utf8');
// const jsCode = `let data = ${jsonContent}; export default data;`;   来回转化比较麻烦，因此建议是js ts
  const ast = parse(fileContent, { sourceType: "module" });

  const visitor: any = {
     
    ObjectProperty(nodePath: any) {
      const { node } = nodePath;
      
      if (defaultLang) {    // 参考的中文
          // 基准 {首页:'header.home'}
        words[node.value?.value] = node.key?.value || node.key?.name;
      } else {
        // 项目中翻译的结构
        words[node.key?.value || node.key?.name] = node.value?.value;
      }
    },
  };

  traverse(ast, visitor);

  return words;  
};

function readJsonFileSync(filePath: string) {
  try {
      // 直接读取并解析JSON
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
  } catch (error) {
      console.error(`读取JSON文件失败: ${path.basename(filePath)}`, error);
      throw error; // 或者返回 null/默认值
  }
}


export const getLocalWordsByFileNameJson = (
  fileName: string,
  defaultLang: boolean,
  instance: BaseI18nHelper,
) => {

  const words: any = {};

  if (!instance.projectRootPath || !instance.localesFullPath) {
    return words;
  }

  const filePath = path.join(instance.localesFullPath, `./${fileName}.${instance.fileType}`);

  if (!fs.existsSync(filePath)) {
    return words;
  }

  const fileContent =readJsonFileSync(filePath);

  return words;
};



