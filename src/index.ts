import { window, workspace, ViewColumn, Position, Range } from "vscode";
import { existsSync } from "fs";
import { join } from "path";
import { getLoadingHtml, getTranslateWebviewHtml, getWordWebviewHtml } from './html';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { ParseError, ParseResult } from "@babel/parser";
import type { File } from '@babel/types';
import { getLocalWordsByFileName, replaceKey, saveToLocalFile } from './service';
import type { ExtensionContext, Uri, WebviewPanel } from "vscode";
import { getFilesByFileType } from './utils';
import { getValue } from "./service";
import * as t from '@babel/types';
const DEFAULT_LANG_TYPE = 'zh-Hans';
interface SourceLocation {
    start: {
        line: number;
        column: number;
    };
    end: {
        line: number;
        column: number;
    };
}

export interface Language {
    langType: string
    localeFileName: string;
}

export interface Words {
    value: string;
    loc: SourceLocation;
    isJsxAttr?: boolean;
    isJsxText?: boolean;
    isTemplate?: boolean;
    rawValue?: string;
    key?: string;
    id: string;
    [k: string]: any;
}

export default class SmartI18nHelper {
    context: ExtensionContext;
    currentTextDocumentFileUri: Uri | undefined;
    webviewPanel: WebviewPanel | undefined;  //新开的vscode页面
    projectRootPath: string | undefined = '';    //项目根路径  ===== "/Users/wangjinli/code/ssr-web-snappass-ai"
    localesPath: string = '';  //翻译文件所在文件夹的路径    ====== "/Users/wangjinli/code/ssr-web-snappass-ai/script"
    importCode: string = '';  //导入国际化的语句
    hookCode: string = '';  //调用useTranslate获取的值 t
    fileType: string = '';   //翻译文件类型
    fileContent: string = '';  //当前tsx文件的字符串
    methodName: string = '';  // 导入方法
    localesFullPath: string = '';
    words: Words[] = [];
    translateWords: Words[] = [];
    languages: Language[] = [];  //支持的语言 遍历一个文件本地
    ast: ParseResult<File> | undefined;
    titleChangeTimer: NodeJS.Timeout | undefined;
    constructor(context: ExtensionContext) {
        this.context = context;
        this.fileContent = window.activeTextEditor?.document.getText() || this.fileContent;
        this.currentTextDocumentFileUri = window.activeTextEditor?.document.uri;
        this.projectRootPath = workspace.workspaceFolders?.[0]?.uri?.fsPath;

        if (!this.currentTextDocumentFileUri || !this.projectRootPath) {
            return;
        }
        if (!this.getCheckSetting()) {
            return;
        }

        this.localesFullPath = join(this.projectRootPath, this.localesPath!);
        // 拿到所有翻译文件json
        this.getLanguages();
        //获取需要翻译的中文
        this.words = this.getChineseWords();
        if (!this.words?.length) { return; }
        // 将需要翻译的中文列举出来
        this.openWordsPage();

    }
    async getLanguages() {

        const transFiles = await getFilesByFileType(this.localesFullPath, this.fileType);
        this.languages = transFiles.map((item) => {
            const fileName = item.fileName.split('.');
            return {
                langType: fileName[0],
                localeFileName: fileName[0]
            };
        });
    }



    /**
     * 检查项目的配置  smart  翻译文件地址
     */
    getCheckSetting() {
        this.localesPath = workspace.getConfiguration().get('smart-i18n-helper.Locales Path') as string;
        if (!this.localesPath) {
            window.showErrorMessage("请先设置存在国际化文件的文件夹地址。");
        }
        this.importCode = workspace.getConfiguration().get('smart-i18n-helper.Import Code') as string || this.importCode;
        this.hookCode = workspace.getConfiguration().get('smart-i18n-helper.Hook Code') as string || this.hookCode;
        this.methodName = workspace.getConfiguration().get('smart-i18n-helper.Method Name') as string || this.methodName;
        this.fileType = workspace.getConfiguration().get('smart-i18n-helper.File Type') as string || this.fileType;
        return !!this.localesPath;
    }

    /**
     *  获取ast 
     */
    getAst(): ParseResult<File> | undefined {
        try {

            this.ast = parse(this.fileContent, {
                sourceType: 'module', // es module
                plugins: [
                    "jsx",
                    [
                        "decorators",
                        {
                            "decoratorsBeforeExport": true
                        }
                    ],
                    "typescript",
                ],
            });
            return this.ast;
        } catch (err) {
            console.log(err, "ast parser error");
        }
    }


 /**
  * 检查节点是否被 t() 函数包裹
  * @param path 
  * @returns  boolean  
  */
   isWrappedByTFunction(path: any): boolean {
    let parent = path.parent;
    
    // 检查是否是 t() 函数的参数
    if (t.isCallExpression(parent)) {
      const callee = parent.callee;
      if (t.isIdentifier(callee, { name: 't' })) {
        return true;
      }
    }
    
    // 检查是否是模板字符串中的 t() 调用
    if (t.isTemplateLiteral(parent)) {
      const grandParent = path.parentPath.parent;
      if (t.isCallExpression(grandParent) && 
          t.isIdentifier(grandParent.callee, { name: 't' })) {
        return true;
      }
    }
    
    // 检查 JSX 属性中的 t() 调用
    if (t.isJSXAttribute(parent)) {
      if (t.isJSXExpressionContainer(parent.value) &&
          t.isCallExpression(parent.value.expression) &&
          t.isIdentifier(parent.value.expression.callee, { name: 't' })) {
        return true;
      }
    }
    
    return false;
  }


    /**
     *  通过ast 获取中文words
     */

    getChineseWordsByAst(ast: ParseResult<File>) {
        const words: Words[] = [];
        traverse(ast, {
            ["StringLiteral"]: (path: any) => {
                if (/[\u4e00-\u9fa5]/.test(path.node.value)) {
                    const isTranslated = this.isWrappedByTFunction(path);
                    words.push({
                        value: path.node.value,
                        loc: path.node.loc,
                        isJsxAttr: path.parent.type === "JSXAttribute",
                        id: `${Math.random()}11`,  
                        isTranslated:isTranslated
                    });
                }
            },
            ["JSXText"]: (path: any) => {
                if (/[\u4e00-\u9fa5]/.test(path.node.value)) {
                    const isTranslated = this.isWrappedByTFunction(path);
                    const val = path.node.value.replace(/\n/g, '').trim();
                    words.push({
                        id: `${Math.random()}1111`,  
                        value: val,
                        loc: path.node.loc,
                        isJsxAttr: true,
                        isJsxText: true,
                        rawValue: path.node.value,
                        isTranslated:isTranslated
                    });
                }
            },
            ["TemplateElement"]: (path: any) => {
                if (/[\u4e00-\u9fa5]/.test(path.node.value.raw)) {
                    const isTranslated = this.isWrappedByTFunction(path);
                    const val = path.node.value.raw.replace(/\n/g, '').trim();
                    words.push({
                        id: `${Math.random}1`,  
                        value: val,
                        loc: path.node.loc,
                        isTemplate: true,
                        isTranslated:isTranslated
                    });
                }
            }

        });
        return words;
    }


    /**
     *  获取fileContent中文的中文字符串
     */
    getChineseWords() {
        // 获取ast 
        const ast = this.getAst();
        if (!ast) { return []; }
        return this.getChineseWordsByAst(ast);
    }

    /**
     *  中文面板 
     */

    openWordsPage() {
        const columnToShowIn = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : ViewColumn.Active;
        if (!this.webviewPanel) {
            this.webviewPanel = window.createWebviewPanel(
                'translate',
                "中文列表",
                columnToShowIn || ViewColumn.Active,
                {
                    retainContextWhenHidden: true,
                    enableScripts: true
                }
            );
        } else {
            this.webviewPanel.reveal(columnToShowIn);
        }

        this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = undefined;
        });
        // 第一步预览当前文件的中文字符串 html 点击翻译
        this.webviewPanel.webview.html = getWordWebviewHtml(this.context, this.words);
        this.webviewPanel.webview.onDidReceiveMessage((e) => this.didReceiveMessageHandle(e));

    }

    skipAndSelectWords(data: Words) {
        if (this.currentTextDocumentFileUri) {
            if (!existsSync(this.currentTextDocumentFileUri.fsPath)) {
                window.showErrorMessage('文件已被删除');
                return;
            }
            const { loc } = data;
            const startPosition = new Position(loc.start.line - 1, loc.start.column);
            const endPosition = new Position(loc.end.line - 1, loc.end.column);
            window.showTextDocument(this.currentTextDocumentFileUri, {
                selection: new Range(startPosition, endPosition),
                preview: false,
            });
        }
    }

     async getTranslateResult(
        defalutLanguage: Language, data: Words[]
      ): Promise<Words[]> {
        const defaultWords = getLocalWordsByFileName(defalutLanguage.localeFileName, true, this);
    
        data.forEach((item: any) => {
          if (defaultWords[item.value]) {
            item.key = defaultWords[item.value];
            item[DEFAULT_LANG_TYPE] = {
              exists: true,
              value: item.value,
            };
          } else {
            // item.key = `${item.id.slice(0, 4)}${item.id.slice(-4)}`;
            item[DEFAULT_LANG_TYPE] = {
              exists: false,
              value: item.value,
            };
          }
        });
    
        const toTranslateLanguages = this.languages.filter(lang => lang.langType !== DEFAULT_LANG_TYPE);
    
        for (let i = 0; i < toTranslateLanguages.length; i += 1) {
          const lang = toTranslateLanguages[i];
    
          const words = getLocalWordsByFileName(lang.localeFileName, false, this);
          const toTranslateWords = data.filter((item: any) => !words[item.key]).map((item: any) => item.value);
    
          let transResult: any = {};
    
          if (toTranslateWords.length) {
            try {
              transResult = {};
            } catch {
              return [];
            }
            if (i !== toTranslateLanguages.length - 1) {
            //   await sleep(1000);
            }
          }
    
          data.forEach((item: Words) => {
            const value = words[item.key!];
            item[lang.langType] = {
              exists: !!value,
              value: value,
            };
          });
    
        }
        return data;
      }





      
    async translate(data: Words[]) {

        if (this.webviewPanel && this.currentTextDocumentFileUri) {

            if (!existsSync(this.currentTextDocumentFileUri.fsPath)) {
                window.showErrorMessage('文件已被删除');
                return;
            }

            let index = 1;

            this.titleChangeTimer = globalThis.setInterval(() => {
                if (this.webviewPanel) {
                    this.webviewPanel.title = `翻译中${".".repeat(index)}`;
                } else {
                    globalThis.clearInterval(this.titleChangeTimer);
                }
                index += 1;
                if (index === 4) {
                    index = 1;
                }
            }, 500);

            this.webviewPanel.title = '翻译中';
            this.webviewPanel.webview.html = getLoadingHtml(this.context);

            if (!this.projectRootPath) {
                return;
            };
            const defalutLanguage = this.languages.find(o => o.langType === DEFAULT_LANG_TYPE);
            if (!defalutLanguage) {
                return;
            }

            // 翻译的结果是以中文为基准
            this.translateWords = await this.getTranslateResult(defalutLanguage, data);

            if (!this.translateWords.length) {
                if (this.titleChangeTimer) {
                    globalThis.clearInterval(this.titleChangeTimer);
                }

                if (this.webviewPanel) {
                    // 退到中文列表页面
                    this.webviewPanel.title = "中文列表";
                    this.webviewPanel.webview.html = getWordWebviewHtml(this.context, this.words);
                }
                return;
            }

            if (this.titleChangeTimer) {
                globalThis.clearInterval(this.titleChangeTimer);
            }

            this.webviewPanel.title = '翻译';
            this.webviewPanel.webview.html = getTranslateWebviewHtml(this.context, this.translateWords, this.languages);
        }
    }


    didReceiveMessageHandle(
        e: { type: string, data: any }
    ) {
        const { type, data } = e;

        const methodMap: { [k: string]: Function } = {
            open: () => {
                this.skipAndSelectWords(data as Words);
            },
            translate: () => {
                this.translate(data as Words[]);
            },
            save: async () => {
                await window.showTextDocument(this.currentTextDocumentFileUri!);
                saveToLocalFile(data as Words[], this);  //   需要新增的翻译语言 
                await this.replaceEditorText(); 
                // 自动导入和翻译hook的调用，后续追加
                // await this.importMethod();
                this.webviewPanel?.dispose();
            },
        };

        if (methodMap[type]) {
            methodMap[type]();
        }
    }

    // 增加导入
    async importMethod(): Promise<void> {
        let isImported = false;
    
        const visitor: any = {
           
          ImportDefaultSpecifier: (nodePath: any) => {
            if (nodePath.node.local.name === this.methodName) {
              isImported = true;
              nodePath.stop();
            }
          },
           
          ImportSpecifier: (nodePath: any) => {
            if (nodePath.node.local.name === this.methodName) {
              isImported = true;
              nodePath.stop();
            }
          },
        };
    
        traverse(this.ast as ParseResult<File>, visitor);
        if (!isImported) {
          await window?.activeTextEditor?.edit(editBuilder => {
            editBuilder.insert(new Position(0, 0), this.importCode);
          });
        }
      }
    async replaceEditorText():Promise<void>{
        await window?.activeTextEditor?.edit(editBuilder=>{
            this.translateWords?.forEach((element)=>{
                const { loc } = element;
                const startPosition = new Position(loc.start.line - 1,loc.start.column);
                const endPosition = new Position(loc.end.line - 1, loc.end.column);
                const selection = new Range(startPosition, endPosition);
                if (!selection) { return; }
                editBuilder.replace(selection,  element.isTranslated ? replaceKey(element) : getValue(element, this));
            });
            
        });

    }
}