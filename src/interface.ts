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
  
  export interface Words {
    value: string;
    loc: SourceLocation;
    isJsxAttr?: boolean;
    isJsxText?: boolean;
    isTemplate?: boolean;
    rawValue?: string;
    id:string;
    key?: string;
    isConsole:boolean;   //翻译页面的是时候，提示用户哪些是删除的console,前置校验
    [k: string]: any;
  }
  
  export interface Language {
    langType: string;
    localeFileName: string;
  }
  