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
  needUpdate: boolean;
  isInFunction: boolean;  //用来判断拆入hookcode的位置,找到函数声明内的中文
}
