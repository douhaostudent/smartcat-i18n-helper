import { window, workspace, ViewColumn, Position, Range } from "vscode";
import { existsSync } from "fs";
import { join } from "path";
import { getLoadingHtml, getTranslateWebviewHtml, getWordWebviewHtml } from './html';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { ParseError, ParseResult } from "@babel/parser";
import type { File } from '@babel/types';
import { getLocalWordsByFileName, replaceKey, saveToLocalFile, getKeyValue } from './editCode';
// import { saveFormatKeyToLocalFile } from "./feature";
import type { ExtensionContext, Uri, WebviewPanel } from "vscode";
import { getFilesByFileType } from './utils';
import { getValue, sleep, showError } from "./editCode";
import * as t from '@babel/types';
import translateSmartcatLocaleAll from './smartcat';
import { Words,Language } from "./interface";
const DEFAULT_LANG_TYPE = 'zh';

export type ComponentType = 'client' | 'ssr' | 'custom'

export default class SmartI18nHelper {
    context: ExtensionContext;
    currentTextDocumentFileUri: Uri | undefined;
    webviewPanel: WebviewPanel | undefined;  //新开的vscode页面
    projectRootPath: string | undefined = '';    //项目根路径  ===== "/Users/wangjinli/code/xxx"
    localesPath: string = '';  //翻译文件所在文件夹的路径    ====== "/Users/wangjinli/code/xxx/a"
    clientImportCode: string = ''; // 客户端导入国际化语句
    ssrImportCode: string = '';    // ssr导入国际化语句
    ssrHookCode: string = '';
    hookCode: string = '';  //调用useTranslate获取的值 t
    componentType: ComponentType = 'ssr';   // ssr上下文
    customImportCode:string = '';  //自定义的导入语句
    customHookCode:string='';  //自定义的hook
    customExpressionStatement:string='';  //自定义表达式
    fileType: string = '';   //翻译文件类型
    fileContent: string = '';  //当前tsx文件的字符串
    methodName: string = '';  // 包裹方法t
    localesFullPath: string = '';
    words: Words[] = [];//需要更新的中文翻译
    translateWords: Words[] = [];
    hasTranslateWordsSet: Set<string> = new Set();  // 默认中文反查的key集合  采用map,查找时间复杂度o(1)
    languages: Language[] = [];  //支持的语言 遍历一个文件本地
    ast: ParseResult<File> | undefined;
    titleChangeTimer: NodeJS.Timeout | undefined;
    trans:any[] = [];
    // trans:any[];
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
        this.trans =  this.getSmartExpressStatement();
        if (!this.words?.length) {
            window.showInformationMessage('当前页面无中文，无需翻译');
            return;
        }
        if (this.ast) {
            this.componentType =  this.customImportCode ? 'custom': this.detectComponentType(this.ast);
        }


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
        this.clientImportCode = workspace.getConfiguration().get('smart-i18n-helper.Client Import Code') as string || this.clientImportCode;
        this.ssrImportCode = workspace.getConfiguration().get('smart-i18n-helper.SSR Import Code') as string || this.ssrImportCode;
        this.hookCode = workspace.getConfiguration().get('smart-i18n-helper.Hook Code') as string || this.hookCode;
        this.ssrHookCode = workspace.getConfiguration().get('smart-i18n-helper.SSR Hook Code') as string || this.ssrHookCode;
        this.methodName = workspace.getConfiguration().get('smart-i18n-helper.Method Name') as string || this.methodName;
        this.fileType = workspace.getConfiguration().get('smart-i18n-helper.File Type') as string || this.fileType;
        this.customImportCode = workspace.getConfiguration().get('smart-i18n-helper.Custom Import Code')as string || this.customImportCode;
        this.customHookCode = workspace.getConfiguration().get('smart-i18n-helper.Custom Hook Code')  as string  || this.customHookCode;
        this.customExpressionStatement =workspace.getConfiguration().get('Custom Expression Statement') as string ||  this.customExpressionStatement;
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
                    "asyncGenerators", // 支持 async/await 和异步生成器
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
     * @param functionName  函数类型
     * @returns  boolean  
     */
    isWrappedBytFunction(path: any): boolean {
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
 * 
 * @param node 
 * @returns 
 */
    /**
   * 检查节点是否被 console 函数包裹
   * @param path Babel 路径对象
   * @returns boolean
   */
    isWrappedByConsole(path: any): boolean {
        const parent = path.parent;

        // 1. 检查是否是 console.x() 的直接参数
        if (t.isCallExpression(parent)) {
            const callee = parent.callee;
            if (
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.object, { name: 'console' }) &&
                t.isIdentifier(callee.property) // 可以是 log/error/warn 等
            ) {
                return true;
            }
        }

        // 2. 检查是否是模板字符串中的 console 调用
        if (t.isTemplateLiteral(parent)) {
            const grandParent = path.parentPath.parent;
            if (
                t.isCallExpression(grandParent) &&
                t.isMemberExpression(grandParent.callee) &&
                t.isIdentifier(grandParent.callee.object, { name: 'console' }) &&
                t.isIdentifier(grandParent.callee.property)
            ) {
                return true;
            }
        }

        // 3. 检查 JSX 属性中的 console 调用
        if (t.isJSXAttribute(parent)) {
            if (
                t.isJSXExpressionContainer(parent.value) &&
                t.isCallExpression(parent.value.expression) &&
                t.isMemberExpression(parent.value.expression.callee) &&
                t.isIdentifier(parent.value.expression.callee.object, { name: 'console' }) &&
                t.isIdentifier(parent.value.expression.callee.property)
            ) {
                return true;
            }
        }

        return false;
    }



    /**
     * 
     * @param  判断节点是否在函数声明内
     * @returns 
     */
    isInsideFunctionDeclaration(nodePath: any) {
        let currentPath = nodePath.parentPath;
        while (currentPath) {
            if (
                currentPath.isFunctionDeclaration() ||
                currentPath.isArrowFunctionExpression() ||
                currentPath.isFunctionExpression()
            ) {
                return true; // 命中函数节点
            }
            currentPath = currentPath.parentPath; // 向上查找
        }
        return false; // 未找到函数节点
    }


    /**
     *  通过ast 获取中文words
     */

    getChineseWordsByAst(ast: ParseResult<File>) {
        const words: Words[] = [];
        traverse(ast, {
            ["StringLiteral"]: (path: any) => {    //普通字符串 "中文"
                if (/[\u4e00-\u9fa5]/.test(path.node.value)) {
                    const isTranslated = this.isWrappedBytFunction(path);
                    const isConsole = this.isWrappedByConsole(path);
                    const isInFunction = this.isInsideFunctionDeclaration(path);
                    words.push({
                        id: `${path.node.loc.start.line}${path.node.loc.start.end}`, //id 必须唯一,删除是以id 维度
                        value: path.node.value,
                        loc: path.node.loc,
                        isJsxAttr: path.parent.type === "JSXAttribute",
                        isTranslated: isTranslated,
                        isConsole: isConsole,
                        needUpdate: false,
                        isInFunction: isInFunction
                    });
                }
            },
            ["JSXText"]: (path: any) => {     // JSX 中的文本（如 <div>中文</div>
                if (/[\u4e00-\u9fa5]/.test(path.node.value)) {
                    const isTranslated = this.isWrappedBytFunction(path);
                    const isConsole = this.isWrappedByConsole(path);
                    const isInFunction = this.isInsideFunctionDeclaration(path);
                    const val = path.node.value.replace(/\n/g, '').trim();
                    words.push({
                        id: `${path.node.loc.start.line}${path.node.loc.start.end}`,  //  todo,id需要是唯一的key 不能有空格
                        value: val,
                        loc: path.node.loc,
                        isJsxAttr: true,
                        isJsxText: true,
                        rawValue: path.node.value,
                        isTranslated: isTranslated,
                        isConsole: isConsole, //默认jsx无console
                        needUpdate: false,
                        isInFunction: isInFunction
                    });
                }
            },
            ["TemplateElement"]: (path: any) => {  // 模板字符串中的静态部分（如 `中文${变量}` 中的 "中文"）
                if (/[\u4e00-\u9fa5]/.test(path.node.value.raw)) {
                    const isTranslated = this.isWrappedBytFunction(path);
                    const isConsole = this.isWrappedByConsole(path);
                    const isInFunction = this.isInsideFunctionDeclaration(path);
                    const val = path.node.value.raw.replace(/\n/g, '').trim();

                    words.push({
                        id: `${path.node.loc.start.line}${path.node.loc.start.end}`,
                        value: val,
                        loc: path.node.loc,
                        isTemplate: true,
                        isTranslated: isTranslated,
                        isConsole: isConsole,
                        needUpdate: false,
                        isInFunction: isInFunction
                    });
                }
            }

        });
        return words;
    }


    extractKeyAndLocation(arrowFunc:any, callNode:any) {
        let key = null;
        
        // 情况1: v => v.PropertyName
        if (arrowFunc.body.type === 'MemberExpression' &&
            arrowFunc.body.property.type === 'Identifier') {
          key = arrowFunc.body.property.name;
        }
        // 情况2: v => { return v.PropertyName; }
        else if (arrowFunc.body.type === 'BlockStatement' &&
                 arrowFunc.body.body.length === 1 &&
                 arrowFunc.body.body[0].type === 'ReturnStatement' &&
                 arrowFunc.body.body[0].argument.type === 'MemberExpression' &&
                 arrowFunc.body.body[0].argument.property.type === 'Identifier') {
          key = arrowFunc.body.body[0].argument.property.name;
        }
        
        if (key) {
          return {
            key: key,
            loc: callNode.loc,
            start: callNode.start,
            end: callNode.end
          };
        }
        
        return null;
      }
      
      

    /**
     *  通过ast 获取旧版 languageStore.smartcatTranslationText((v) => v.Invitation_code_discount)的语句和key
     */
    getSmartExpressStatement(){
        const ast = this.getAst();
        if (!ast) { return []; }
        const trans:any[] = [];
        traverse(ast, {
            CallExpression:(path) =>{
              const { node } = path;
              
              // 检查是否是 languageStore.smartcatTranslationText 调用
              if (node.callee.type === 'MemberExpression' &&
                  node.callee.object.type === 'Identifier' &&
                  node.callee.object.name === 'languageStore' &&
                  node.callee.property.type === 'Identifier' &&
                  node.callee.property.name === 'smartcatTranslationText') {
                
                // 检查参数是否为箭头函数
                if (node.arguments.length > 0 && 
                    node.arguments[0].type === 'ArrowFunctionExpression') {
                        const arrowFunc = node.arguments[0];
        
                        // 提取属性名和位置信息
                        const keyInfo = this.extractKeyAndLocation(arrowFunc, node);
                        if (keyInfo) {
                        trans.push(keyInfo);
                        }
                      }
                    }
                  }
                });
                
        return trans;
          
    }


    /**
     * 通过分析ast分析当前组件类型
     * @param ast  
     */
    detectComponentType(ast: ParseResult<File>): ComponentType {
        let isClient = false;
        if (ast) {
            traverse(ast, {
                'DirectiveLiteral': (path: any) => {
                    if (path.node.value === 'use client') {
                        isClient = true;
                        path.stop(); // 找到任意一个即可终止遍历

                    }
                    // if (path.node.value === 'use server') {
                    //     isSSR = true;
                    //     path.stop(); // 找到任意一个即可终止遍历
                    // }

                },
                'CallExpression': (path: any) => {
                    const callee = path.node.callee;
                    if (t.isIdentifier(callee)) {
                        const hookNames = ['useState', 'useEffect', 'useLayoutEffect', 'useRef'];
                        if (hookNames.includes(callee.name)) {
                            isClient = true;
                            path.stop(); // 找到任意一个即可终止遍历
                        }
                    }

                },
                // 检测浏览器 API
                'MemberExpression': (path: any) => {
                    if (
                        t.isIdentifier(path.node.object, { name: 'window' }) ||
                        t.isIdentifier(path.node.object, { name: 'document' })
                    ) {
                        isClient = true;
                        path.stop();
                    }
                },
                'JSXAttribute': (path: any) => {
                    if (
                        t.isJSXIdentifier(path.node.name, { name: 'onClick' }) ||
                        t.isJSXIdentifier(path.node.name, { name: 'onChange' })
                    ) {
                        isClient = true;
                        path.stop(); // 找到任意一个即可终止遍历

                    }

                }
            });

        }
        return isClient ? 'client' : 'ssr';
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
        //  以英文key 为唯一标识，暂不考虑中文重复的case
        Object.entries(defaultWords).forEach(([key, value]) => {
            this.hasTranslateWordsSet.add(value as string);
        });
        let needSmartCatTranslateWords: Words[] = [];  //中文【首页】
        let hasTranslatedWords: Words[] = [];
        data.forEach((item: any) => {

            if (defaultWords[item.value] && !item.needUpdate) {
                item.key = defaultWords[item.value];
                item.isRepetitionKey = false; //本地已有的翻译 对象，不会有重复的key ,无需判断
                item[DEFAULT_LANG_TYPE] = {
                    exists: true,
                    value: item.value,
                };
                hasTranslatedWords.push(item);
            } else {
                //需要smart翻译的key需要拉取翻译，再赋值   [没有翻译]【需要更新】的合集
                item[DEFAULT_LANG_TYPE] = {
                    exists: false,
                    // value: item.value,
                    value: '',
                };
                needSmartCatTranslateWords.push(item);
            }
        });

        const toTranslateLanguages = this.languages.filter(lang => lang.langType !== DEFAULT_LANG_TYPE);
        let smartcatResult: { [key: string]: Record<string, string> } = {};
        let allLangSmartcatResult: any = [];
        // 翻译文件已有相应的key 
        for (let i = 0; i < toTranslateLanguages.length; i += 1) {
            const lang = toTranslateLanguages[i];
            const words = getLocalWordsByFileName(lang.localeFileName, false, this);
            hasTranslatedWords.forEach((item: Words) => {
                const value = words[item.key!];
                item[lang.langType] = {
                    exists: !!value,
                    value: value,
                };
            });
        }
        if (needSmartCatTranslateWords.length) {
            allLangSmartcatResult = await translateSmartcatLocaleAll();
            for (let i = 0; i < toTranslateLanguages.length; i += 1) {
                const lang = toTranslateLanguages[i];
                smartcatResult = allLangSmartcatResult.length && allLangSmartcatResult.find((item: any) => item && item.langType === lang.langType).result;
                needSmartCatTranslateWords.forEach((item: Words, index) => {
                    //需要给新追加赋值key     
                    if (item[DEFAULT_LANG_TYPE].exists === false) {
                        const defaultLangTypeTransResult = allLangSmartcatResult.length && allLangSmartcatResult.find((item: any) => item && item.langType === DEFAULT_LANG_TYPE).result;
                        const key = Object.entries(defaultLangTypeTransResult).find(([k, v]) => v === item.value)?.[0];   //标准中文翻译ts对象中返查key
                        if (key) {
                            item.key = key;
                            item.isRepetitionKey = this.hasTranslateWordsSet.has(key);
                            // 基准文件zh-Hans 追加合并smart远程数据
                            defaultWords[key] = defaultLangTypeTransResult[key];
                            // 合并 ------ 将远程拉取的翻译与现有的翻译文件 ,只合并当前翻译的key,value
                            //   smartcatResult[key!];
                            // 基准文件合并后，同步相应的数据       
                            item[DEFAULT_LANG_TYPE] = {
                                exists: false,
                                value: defaultLangTypeTransResult[key],
                            };
                            // 需要翻译的语言文件合并后，同步相应的数据
                            item[lang.langType] = {
                                exists: false,
                                value: smartcatResult[key!],
                            };
                        } else {
                            //smart 远程没有相应的key翻译
                            const tempKey = `no-translate-word${index}`;
                            item.key = tempKey;
                            item.isRepetitionKey = true;
                            defaultWords[tempKey!] = '暂无翻译';
                            // 需要翻译的语言文件合并后，同步相应的数据
                            item[lang.langType] = {
                                exists: false,
                                value: '',
                            };
                        }

                    }

                });
            }
        }

        return hasTranslatedWords.concat(needSmartCatTranslateWords);
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
            this.webviewPanel.webview.html = getTranslateWebviewHtml(this.context, this.translateWords, this.languages, this.componentType);
        }
    }

/**
 * 
 * @param e webview postmessage 事件 
 */
    didReceiveMessageHandle(
        e: { type: string, data: any }
    ) {
        const { type, data } = e;

        const methodMap: { [k: string]: Function } = {
            open: () => {
                this.skipAndSelectWords(data as Words);
            },
            update: () => {
                if (this.webviewPanel) {
                    this.webviewPanel.webview.html = getWordWebviewHtml(this.context, data);
                }
            },
            translate: () => {

                this.translate(data as Words[]);
            },
            save: async () => {
                //保存-最后阶段是层层过滤后的需要更换的word
                if (!data.length) {
                    this.webviewPanel?.dispose();
                } else {
                    await window.showTextDocument(this.currentTextDocumentFileUri!);
                    saveToLocalFile(data as Words[], this);  //   每个翻译文件语言追加
                    await this.replaceEditorText(data as Words[]);
                    await this.replaceOldSmartText();
                    // 自动导入和翻译hook的调用，后续追加
                    const allIsConfigWord = this.words.every(item => !item.isInFunction);
                    if (!allIsConfigWord) {
                        const isInsert = await this.importMethod();  //需要返回是否新增，会影响hookcode的行号，新增修改ast,会增加行号
                        await this.insertHookCode(isInsert);
                    }
                    this.getSmartExpressStatement();
                    this.webviewPanel?.dispose();

                }

            },
        };

        if (methodMap[type]) {
            methodMap[type]();
        }
    }

    /**
     * 增加导入函数语句  编辑器 API 提供的方法，用于在指定位置插入内容。
     * @returns 
     */

    async importMethod(): Promise<boolean> {
        let isImported = false;
        const importLines: number[] = []; // 收集所有 import 的行号
        const importFunctionNames = ['useTranslations', 'getTranslations', 'useLanguageStore'];
    
        const visitor: any = {
            ImportDeclaration: (nodePath: any) => {
                // 收集每个 import 语句的结束行
                importLines.push(nodePath.node.loc.end.line);
            },
    
            ImportDefaultSpecifier: (nodePath: any) => {
                if (importFunctionNames.includes(nodePath.node.local.name)) {
                    isImported = true;
                    nodePath.stop();
                }
            },
    
            ImportSpecifier: (nodePath: any) => {
                if (importFunctionNames.includes(nodePath.node.local.name)) {
                    isImported = true;
                    nodePath.stop();
                }
            },
        };
    
        traverse(this.ast as ParseResult<File>, visitor);
        
        if (!isImported) {
            // 找到最大的行号（最后一个 import）
            const lastImportLine = importLines.length > 0 ? Math.max(...importLines) : 0;
            
            await window?.activeTextEditor?.edit(editBuilder => {
                const shouldImportCode = (this.componentType === 'custom' ? this.customImportCode : 
                                        (this.componentType === 'client' ? this.clientImportCode : this.ssrImportCode));
                
                const insertPosition = new Position(lastImportLine, 0);
                editBuilder.insert(insertPosition, '\n' + shouldImportCode); // 在前面加换行，确保在新的一行
            });
            return true;
        } else {
            return false;
        }
    }

    /**
     * 增加hook调用
     */
    async insertHookCode(isInsertImport:boolean): Promise<void> {
        let hasHookCode = false;
        let allWordsInSamescope = false;    // 先过滤不在函数声明内的中文
        let hookStartLine = 0;
        const visitor: any = {
            FunctionDeclaration: (nodePath: any) => {
                const functionBody = nodePath.node.body;
                const inFunctionWords = this.words.filter(word => word.isInFunction);
                if (!inFunctionWords?.length) { return; }
                const scopeCode = this.fileContent.slice(functionBody.start, functionBody.end);
                //  严格通过作用域内去判断 检查是否包含所有目标中文字符   todo:待完善精准判断 
                allWordsInSamescope = inFunctionWords.every(word =>
                    scopeCode.includes(word.value)
                );
                if (allWordsInSamescope) {
                    hookStartLine = isInsertImport ? nodePath.node.body.loc.start.line + 1 : nodePath.node.body.loc.start.line;// 获取函数声明起始行号
                }
            },
            ArrowFunctionExpression:(nodePath:any)=>{
                const functionBody = nodePath.node.body;
                const inFunctionWords = this.words.filter(word => word.isInFunction);
                if (!inFunctionWords?.length) { return; }
                const scopeCode = this.fileContent.slice(functionBody.start, functionBody.end);
                //  严格通过作用域内去判断 检查是否包含所有目标中文字符   todo:待完善精准判断 
                allWordsInSamescope = inFunctionWords.every(word =>
                    scopeCode.includes(word.value)
                );
                if (allWordsInSamescope) {
                    hookStartLine = isInsertImport ? nodePath.node.body.loc.start.line + 1 : nodePath.node.body.loc.start.line;// 获取函数声明起始行号
                }
            },
            VariableDeclaration: (nodePath: any) => {
                if(this.componentType === 'custom' && nodePath.node.declarations.some((decl:any)=>decl.id.name === "t"&& decl.init?.type === 'CallExpression' && decl.init.callee.name === 'useLanguageStore'))
                    {
                        hasHookCode = true;
                    }    

                if (
                     (this.componentType ==='client' ||this.componentType === 'ssr') &&nodePath.node.declarations.some(
                        (decl: any) =>
                            decl.id.name === 't' &&
                            decl.init?.type === 'CallExpression' &&
                            (decl.init.callee.name === 'useTranslations' || decl.init.callee.name === 'getTranslations')
                    )
                ) {
                    hasHookCode = true;
              
                }
            },

        };

        traverse(this.ast as ParseResult<File>, visitor);
        if (!hasHookCode) {
            await window?.activeTextEditor?.edit(editBuilder => {
                const hookCode = this.componentType === 'custom' ? this.customHookCode :(this.componentType === 'client' ? this.hookCode : this.ssrHookCode);
                // insert 获取函数声明所在行号
                editBuilder.insert(new Position(hookStartLine, 0), hookCode);
            });
        }

    }
    async replaceEditorText(data: Words[]): Promise<void> {
        // 过滤从smartkey 新拉取的重复key 要保持key的唯一性  
        await window?.activeTextEditor?.edit(editBuilder => {
            data.forEach((element) => {
                const { loc } = element;
                const startPosition = new Position(loc.start.line - 1, loc.start.column);
                const endPosition = new Position(loc.end.line - 1, loc.end.column);
                const selection = new Range(startPosition, endPosition);
                if (!selection) { return; }
                // isInFunction  不被函数作用域包裹的，判断为变量   todo 精确判断返回jsx jsx组件内的中文才追加
                editBuilder.replace(selection, (element.isTranslated || !element.isInFunction) ? replaceKey(element) : getValue(element, this));
            });

        });

    }
    //替换旧版写法
    async  replaceOldSmartText () {
        await  window. activeTextEditor?.edit(editBuilder=>{
            this.trans.forEach((ele)=>{
                const { loc,key } = ele;
                const startPosition = new Position(loc.start.line - 1, loc.start.column);
                const endPosition = new Position(loc.end.line - 1, loc.end.column);
                const selection = new Range(startPosition, endPosition);
                if (!selection) { return; }
                editBuilder.replace(selection,getKeyValue(key, this));
                
            });
            
        });

    }
}