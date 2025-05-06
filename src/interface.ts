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
    [k: string]: any;
  }
  
  export interface Language {
    langType: string;
    localeFileName: string;
  }
  