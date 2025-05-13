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
 /**
  *  在原有的翻译文件js,ts中追加 key,value
  * @param 追加翻译
  * @param instance   
  * @returns 
  */
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

  instance.languages.forEach(async lang => {

    const fullFilePath = path.join(instance.localesFullPath!, `./${lang.localeFileName}.${instance.fileType}`);
    if (!fs.existsSync(fullFilePath)) {
      window.showWarningMessage(`${lang.localeFileName}文件不存在，已为您自动生成。`);
      fs.writeFileSync(fullFilePath, 'export default {}');
    } 
    //需要更新的字段翻译
    const updateWords = data.filter(item=>item.needUpdate).reduce((prev:{key:string,value:string}[],item:any)=>{
      prev.push({
        key: item.key,
        value: item[lang.langType]?.value,
      });
      return prev;
    },[]);
    // smart拉取新增的key,与当前本地key重复的,filter
    const newWords = data.filter(item=>!item?.isRepetitionKey&& !item.needUpdate).reduce((prev: { key: string, value: string}[], item: any) => {
        
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
     // 遍历到对象表达式时，动态添加新属性  添加前检查 key 唯一性
    const visitor: any = {
      // 更新属性
      ObjectProperty(nodePath:any) {
        updateWords.forEach(item=>{
          if(item.key === nodePath.node.key.name){
            nodePath.node.value.value = item.value;
          }
        });
      },
       
      ObjectExpression(nodePath: any) {
         // 仅处理顶层对象 ,不然子对象也会依次追加属性，比如seo.title
      if (!t.isProgram(nodePath.parentPath.parent)) {return;}
        const { node } = nodePath;
         // 追加新的属性
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
// 这段代码使用 @babel/generator 将修改后的 AST 转换回代码字符串：
// 适用场景：需要保留原始字符而非 Unicode 转义时
    const newContent = generator(ast, {
      jsescOption: { minimal: true },   
    }).code;

    const formattedCode = await prettier.format(
      newContent,
      {
        parser: 'babel',
        printWidth: 200,          // 单行最大长度（避免对象被拆分成多行）
        singleQuote: true,        // 使用单引号
        // semi: false,              // 不加分号
        trailingComma: "es5",    // es5语法尾随逗号
        proseWrap: "never"        // 禁止 Markdown 自动换行（对 JS 对象也有效）
      
      }
    );
      fs.writeFileSync(fullFilePath,  formattedCode);
    
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


export function sleep(time: number) {
  return new Promise((resolve: any) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
}

export function showError(errorText:string) {
  if (errorText) {
    window.showErrorMessage(errorText);
  }
}



