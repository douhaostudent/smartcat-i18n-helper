import { window, workspace, ViewColumn, Position, Range } from "vscode";
import { existsSync } from "fs";
import { join } from "path";
import { getLoadingHtml, getTranslateWebviewHtml, getWordWebviewHtml } from './html';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { ParseError, ParseResult } from "@babel/parser";
import type { File } from '@babel/types';
import { getLocalWordsByFileName, replaceKey, saveToLocalFile } from './service';
import { saveFormatKeyToLocalFile } from "./feature";
import type { ExtensionContext, Uri, WebviewPanel } from "vscode";
import { getFilesByFileType } from './utils';
import { getValue, sleep, showError } from "./service";
import * as t from '@babel/types';
import translateSmartcatLocaleAll from './smartcat';
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
    isConsole: boolean;
    key?: string;
    id: string;
    [k: string]: any;
    needUpdate:boolean;
}
 export type ComponentType = 'client' | 'ssr'

export default class SmartI18nHelper {
    context: ExtensionContext;
    currentTextDocumentFileUri: Uri | undefined;
    webviewPanel: WebviewPanel | undefined;  //新开的vscode页面
    projectRootPath: string | undefined = '';    //项目根路径  ===== "/Users/wangjinli/code/ssr-web-snappass-ai"
    localesPath: string = '';  //翻译文件所在文件夹的路径    ====== "/Users/wangjinli/code/ssr-web-snappass-ai/script"
    importCode: string = '';  //导入国际化的语句
    hookCode: string = '';  //调用useTranslate获取的值 t
    componentType:  ComponentType = 'ssr';   // ssr上下文
    fileType: string = '';   //翻译文件类型
    fileContent: string = '';  //当前tsx文件的字符串
    methodName: string = '';  // 导入方法
    localesFullPath: string = '';
    words: Words[] = [];//需要更新的中文翻译
    translateWords: Words[] = [];
    hasTranslateWordsSet: Set<string> = new Set();  // 默认中文反查的key集合  采用map,查找时间复杂度o(1)
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
        if (!this.words?.length) {
            window.showInformationMessage('当前页面无中文，无需翻译');
            return;
        }
        if (this.ast) {
            this.componentType = this.detectComponentType(this.ast);
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
     *  通过ast 获取中文words
     */

    getChineseWordsByAst(ast: ParseResult<File>) {
        const words: Words[] = [];
        traverse(ast, {
            ["StringLiteral"]: (path: any) => {    //普通字符串 "中文"
                if (/[\u4e00-\u9fa5]/.test(path.node.value)) {
                    const isTranslated = this.isWrappedBytFunction(path);
                    const isConsole = this.isWrappedByConsole(path);
                    words.push({
                        id: `${path.node.loc.start.line}${path.node.loc.start.end}`, //id 必须唯一,删除是以id 维度
                        value: path.node.value,
                        loc: path.node.loc,
                        isJsxAttr: path.parent.type === "JSXAttribute",
                        isTranslated: isTranslated,
                        isConsole: isConsole,
                        needUpdate:false,
                    });
                }
            },
            ["JSXText"]: (path: any) => {     // JSX 中的文本（如 <div>中文</div>
                if (/[\u4e00-\u9fa5]/.test(path.node.value)) {
                    const isTranslated = this.isWrappedBytFunction(path);
                    const isConsole = this.isWrappedByConsole(path);
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
                        needUpdate:false,
                    });
                }
            },
            ["TemplateElement"]: (path: any) => {  // 模板字符串中的静态部分（如 `中文${变量}` 中的 "中文"）
                if (/[\u4e00-\u9fa5]/.test(path.node.value.raw)) {
                    const isTranslated = this.isWrappedBytFunction(path);
                    const isConsole = this.isWrappedByConsole(path);
                    const val = path.node.value.raw.replace(/\n/g, '').trim();
                    words.push({
                        id: `${path.node.loc.start.line}${path.node.loc.start.end}`,
                        value: val,
                        loc: path.node.loc,
                        isTemplate: true,
                        isTranslated: isTranslated,
                        isConsole: isConsole,
                        needUpdate:false,
                    });
                }
            }

        });
        return words;
    }

    /**
     * 通过分析ast分析当前组件类型
     * @param ast  
     */
    detectComponentType(ast: ParseResult<File>): ComponentType {
        let isSSR = false;
        let isClient = false;
        if (ast) {
            traverse(ast, {
                'DirectiveLiteral': (path: any) => {
                    if (path.node.value === 'use client') {
                        isClient = true;
                        path.stop(); // 找到任意一个即可终止遍历

                    }
                    if (path.node.value === 'use server') {
                        isSSR = true;
                        path.stop(); // 找到任意一个即可终止遍历
                    }

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
                //保存-最后阶段是层层过滤后的需要更换的word
                if (!data.length) {
                    this.webviewPanel?.dispose();
                } else {
                    await window.showTextDocument(this.currentTextDocumentFileUri!);
                    saveToLocalFile(data as Words[], this);  //   每个翻译文件语言追加
                    await this.replaceEditorText(data as Words[]);
                    // 自动导入和翻译hook的调用，后续追加
                    // await this.importMethod();
                    this.webviewPanel?.dispose();

                }

            },
        };

        if (methodMap[type]) {
            methodMap[type]();
        }
    }

    // 增加导入

    // ​​Position(0, 0)​​
    // 表示插入位置的行号和列号（从 0 开始计数），这里指文件开头。
    // ​​this.importCode​​
    // 是要插入的代码片段，通常是一个字符串（如 import ... 语句）。
    // ​​editBuilder.insert​​
    // 是编辑器 API 提供的方法，用于在指定位置插入内容。

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
                    nodePath.stop();  // 立即终止当前 AST 的遍历​​，避免不必要的后续检查
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
    async replaceEditorText(data: Words[]): Promise<void> {
        // 过滤从smartkey 新拉取的重复key 要保持key的唯一性  
        await window?.activeTextEditor?.edit(editBuilder => {
            data.forEach((element) => {
                const { loc } = element;
                const startPosition = new Position(loc.start.line - 1, loc.start.column);
                const endPosition = new Position(loc.end.line - 1, loc.end.column);
                const selection = new Range(startPosition, endPosition);
                if (!selection) { return; }
                editBuilder.replace(selection, element.isTranslated ? replaceKey(element) : getValue(element, this));
            });

        });

    }
}