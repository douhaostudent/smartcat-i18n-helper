import { commands, ExtensionContext } from 'vscode';

import * as fs from 'fs';
import * as path from 'path';
import * as ejs from 'ejs';
import type { ComponentType } from '..';

import { Language, Words } from '../interface';

export const getWordWebviewHtml = (
  context: ExtensionContext,
  words: Words[],
) => {
  let html = fs.readFileSync(
    path.join(
      context.extensionPath, './dist/src/html/word.ejs'
    )
  ).toString();

  html = ejs.render(html, { words });
  return html;
};

export const getLoadingHtml = (
  context: ExtensionContext,
) => {
  return fs.readFileSync(
    path.join(context.extensionPath, './dist/src/html/loading.ejs')
  ).toString();
};

export const getTranslateWebviewHtml = (
  context: ExtensionContext,
  translateWords: Words[],
  languages: Language[],
  componentType:ComponentType
) => {
  let html = fs.readFileSync(
    path.join(context.extensionPath, './dist/src/html/translate.ejs')
  ).toString();
  html = ejs.render(html, {
    words: translateWords,
    languages: languages,
    componentType:componentType
  });
  return html;
};
