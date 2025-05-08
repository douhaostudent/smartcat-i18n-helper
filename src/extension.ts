
import * as vscode from 'vscode';
import SmartI18nHelper from './index';

export function activate(context: vscode.ExtensionContext) {

	let reactI18Helper:SmartI18nHelper;
	console.log('Congratulations, your extension "smart-i18n-helper" is now active!');
	const disposable = vscode.commands.registerCommand('smart-i18n-helper.helloWorld', () => {
		if(reactI18Helper?.webviewPanel){
          reactI18Helper?.webviewPanel.dispose();
		}
		reactI18Helper = new SmartI18nHelper(context);
		vscode.window.showInformationMessage('Hello World from smart-i18n-helper!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
