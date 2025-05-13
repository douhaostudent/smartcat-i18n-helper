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
  *  格式化的ts中_为.
  * @param 追加翻译
  * @param instance   
  * @returns 
  */
 export const saveFormatKeyToLocalFile = (
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

    const fileContent = fs.readFileSync(fullFilePath).toString();

    const ast = parse(fileContent, { sourceType: "module", plugins: ['typescript'] });  
     // 遍历到对象表达式时，动态添加新属性  添加前检查 key 唯一性
    const visitor: any = {
      // 更新属性
    //   ObjectProperty(nodePath: any) {
    //      // 仅处理顶层对象 ,不然子对象也会依次追加属性，比如seo.titl
    //        const { node } = nodePath;    
    //         const valueNode = node.value;
    //         // 仅处理字符串字面量
    //         if (valueNode.type === 'StringLiteral') {
    //           valueNode.value = valueNode.value.replace(/_/g, '.');
    //         }
    //      // 追加新的属性
       
    //   },
     // 处理对象属性
     ObjectProperty(path:any) {
        if (t.isStringLiteral(path.node.value)) {
          path.node.value.value = path.node.value.value.replace(/_/g, '.');
        }
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




