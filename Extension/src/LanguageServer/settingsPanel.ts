/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as util from '../common';
import * as config from './configurations';
import * as telemetry from '../telemetry';

// TODO: share ElementId between SettingsPanel and SettingsApp. Investigate why SettingsApp cannot import/export
const elementId: { [key: string]: string } = {
    // Basic settings
    configName: "configName",
    configSelection: "configSelection",
    addConfigBtn: "addConfigBtn",
    addConfigOk: "addConfigOk",
    addConfigCancel: "addConfigCancel",
    addConfigName: "addConfigName",

    compilerPath: "compilerPath",
    compilerPathInvalid: "compilerPathInvalid",
    knownCompilers: "knownCompilers",
    compilerArgs: "compilerArgs",

    intelliSenseMode: "intelliSenseMode",
    intelliSenseModeInvalid: "intelliSenseModeInvalid",
    includePath: "includePath",
    includePathInvalid: "includePathInvalid",
    defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard",

    // Advanced settings
    windowsSdkVersion: "windowsSdkVersion",
    macFrameworkPath: "macFrameworkPath",
    compileCommands: "compileCommands",
    configurationProvider: "configurationProvider",
    forcedInclude: "forcedInclude",

    // Browse properties
    browsePath: "browsePath",
    limitSymbolsToIncludedHeaders: "limitSymbolsToIncludedHeaders",
    databaseFilename: "databaseFilename",

    // Other
    showAdvancedBtn: "showAdvancedBtn"
};

export class SettingsPanel {
    private telemetry: { [key: string]: number } = {};
    private disposable: vscode.Disposable = undefined;

    // Events
    private settingsPanelActivated = new vscode.EventEmitter<void>();
    private configValuesChanged = new vscode.EventEmitter<void>();
    private configSelectionChanged = new vscode.EventEmitter<void>();
    private addConfigRequested = new vscode.EventEmitter<string>();

    // Configuration data
    private configValues: config.Configuration;
    private isIntelliSenseModeDefined: boolean = false;
    private configIndexSelected: number = 0;
    private compilerPaths: string[] = [];

    // WebviewPanel objects
    private panel: vscode.WebviewPanel;
    private disposablesPanel: vscode.Disposable = undefined;
    private static readonly viewType: string = 'settingsPanel';
    private static readonly title: string = 'C/C++ Configurations';

    constructor() {
        this.configValues = { name: undefined };
        this.disposable = vscode.Disposable.from(
            this.settingsPanelActivated,
            this.configValuesChanged,
            this.configSelectionChanged,
            this.addConfigRequested
        );
    }

    public createOrShow(configSelection: string[], activeConfiguration: config.Configuration, errors: config.ConfigurationErrors): void {
        const column: vscode.ViewColumn = vscode.window.activeTextEditor
                ? vscode.window.activeTextEditor.viewColumn
                : undefined;

        // Show existing panel
        if (this.panel) {
            this.panel.reveal(column, false);
            return;
        }

        // Create new panel
        this.panel = vscode.window.createWebviewPanel(
            SettingsPanel.viewType,
            SettingsPanel.title,
            column || vscode.ViewColumn.One,
            {
                enableCommandUris: true,
                enableScripts: true,

                // Restrict the webview to only loading content from these directories
                localResourceRoots: [
                    vscode.Uri.file(util.extensionPath),
                    vscode.Uri.file(path.join(util.extensionPath, 'ui')),
                    vscode.Uri.file(path.join(util.extensionPath, 'out', 'ui'))]
            }
        );

        this.panel.iconPath = vscode.Uri.file(util.getExtensionFilePath("LanguageCCPP_color_128x.png"));

        this.disposablesPanel = vscode.Disposable.from(
            this.panel,
            this.panel.onDidDispose(this.onPanelDisposed, this),
            this.panel.onDidChangeViewState(this.onViewStateChanged, this),
            this.panel.webview.onDidReceiveMessage(this.onMessageReceived, this),
            vscode.window.onDidChangeWindowState(this.onWindowStateChanged, this)
        );

        this.panel.webview.html = this.getHtml();

        this.updateWebview(configSelection, activeConfiguration, errors);
    }

    public get SettingsPanelActivated(): vscode.Event<void> {
        return this.settingsPanelActivated.event;
    }

    public get ConfigValuesChanged(): vscode.Event<void> {
        return this.configValuesChanged.event;
    }

    public get ConfigSelectionChanged(): vscode.Event<void> {
        return this.configSelectionChanged.event;
    }

    public get AddConfigRequested(): vscode.Event<string> {
        return this.addConfigRequested.event;
    }

    public get selectedConfigIndex(): number {
        return this.configIndexSelected;
    }

    public set selectedConfigIndex(index: number) {
        this.configIndexSelected = index;
    }

    public getLastValuesFromConfigUI(): config.Configuration {
        return this.configValues;
    }

    public updateConfigUI(configSelection: string[], configuration: config.Configuration, errors: config.ConfigurationErrors|null): void {
        if (this.panel) {
            this.updateWebview(configSelection, configuration, errors);
        }
    }

    public setKnownCompilers(knownCompilers: config.KnownCompiler[], pathSeparator: string): void {
        if (knownCompilers && knownCompilers.length) {
            for (let compiler of knownCompilers) {
                // Normalize path separators.
                let path: string = compiler.path;
                if (pathSeparator === "Forward Slash") {
                    path = path.replace(/\\/g, '/');
                } else {
                    path = path.replace(/\//g, '\\');
                }
                // Do not add duplicate paths in case the default compilers for cpp and c are the same.
                if (this.compilerPaths.indexOf(path) === -1) {
                    this.compilerPaths.push(path);
                }
            }
        }
    }

    public updateErrors(errors: config.ConfigurationErrors): void {
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'updateErrors', errors: errors});
        }
    }

    public dispose(): void {
        // Log any telemetry
        if (Object.keys(this.telemetry).length) {
            telemetry.logLanguageServerEvent("ConfigUI", null, this.telemetry);
        }

        // Clean up resources
        this.panel.dispose();

        if (this.disposable) {
            this.disposable.dispose();
        }

        if (this.disposablesPanel) {
            this.disposablesPanel.dispose();
        }
    }

    private onPanelDisposed(): void {
        if (this.disposablesPanel) {
            this.disposablesPanel.dispose();
            this.panel = undefined;
        }
    }

    private updateWebview(configSelection: string[], configuration: config.Configuration, errors: config.ConfigurationErrors|null): void {
        this.configValues = {...configuration}; // Copy configuration values
        this.isIntelliSenseModeDefined = (this.configValues.intelliSenseMode !== undefined);
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'setKnownCompilers', compilers: this.compilerPaths });
            this.panel.webview.postMessage({ command: 'updateConfigSelection', selections: configSelection, selectedIndex: this.configIndexSelected });
            this.panel.webview.postMessage({ command: 'updateConfig', config: this.configValues });
            if (errors !== null) {
                this.panel.webview.postMessage({ command: 'updateErrors', errors: errors });
            }
        }
    }

    private onViewStateChanged(e: vscode.WebviewPanelOnDidChangeViewStateEvent): void {
        if (e.webviewPanel.active) {
            this.settingsPanelActivated.fire();
        }
    }

    private onWindowStateChanged(e: vscode.WindowState): void {
        if (e.focused) {
            this.settingsPanelActivated.fire();
        }
    }

    private onMessageReceived(message: any): void {
        if (message === null) {
            return;
        }
        switch (message.command) {
            case 'change':
                this.updateConfig(message);
                break;
            case 'configSelect':
                this.configSelect(message.index);
                break;
            case 'addConfig':
                this.addConfig(message.name);
                break;
            case 'knownCompilerSelect':
                this.knownCompilerSelect();
                break;
        }
    }

    private addConfig(name: string): void {
        this.addConfigRequested.fire(name);
        this.logTelemetryForElement(elementId.addConfigName);
    }

    private configSelect(index: number): void {
        this.configIndexSelected = index;
        this.configSelectionChanged.fire();
        this.logTelemetryForElement(elementId.configSelection);
    }

    private knownCompilerSelect(): void {
        this.logTelemetryForElement(elementId.knownCompilers);
        // Remove one count from compilerPath because selecting a different compiler causes a change on the compiler path
        if (this.telemetry[elementId.compilerPath]) {
            this.telemetry[elementId.compilerPath]--;
        }
    }

    private updateConfig(message: any): void {
        let splitEntries: (input: any) => string[] = (input: any) => {
            return input.split("\n").filter((e: string) => e);
        };

        switch (message.key) {
            case elementId.configName:
                this.configValues.name = message.value;
                break;
            case elementId.compilerPath:
                this.configValues.compilerPath = message.value;
                break;
            case elementId.compilerArgs:
                this.configValues.compilerArgs = splitEntries(message.value);
                break;
            case elementId.includePath:
                this.configValues.includePath = splitEntries(message.value);
                break;
            case elementId.defines:
                this.configValues.defines = splitEntries(message.value);
                break;
            case elementId.intelliSenseMode:
                if (message.value !== "${default}" || this.isIntelliSenseModeDefined) {
                    this.configValues.intelliSenseMode = message.value;
                } else {
                    this.configValues.intelliSenseMode = undefined;
                }
                break;
            case elementId.cStandard:
                this.configValues.cStandard = message.value;
                break;
            case elementId.cppStandard:
                this.configValues.cppStandard = message.value;
                break;
            case elementId.windowsSdkVersion:
                this.configValues.windowsSdkVersion = message.value;
                break;
            case elementId.macFrameworkPath:
                this.configValues.macFrameworkPath = splitEntries(message.value);
                break;
            case elementId.compileCommands:
                this.configValues.compileCommands = message.value;
                break;
            case elementId.configurationProvider:
                this.configValues.configurationProvider = message.value;
                break;
            case elementId.forcedInclude:
                this.configValues.forcedInclude = splitEntries(message.value);
                break;
            case elementId.browsePath:
                this.initializeBrowseProperties();
                this.configValues.browse.path = splitEntries(message.value);
                break;
            case elementId.limitSymbolsToIncludedHeaders:
                this.initializeBrowseProperties();
                this.configValues.browse.limitSymbolsToIncludedHeaders = message.value;
                break;
            case elementId.databaseFilename:
                this.initializeBrowseProperties();
                this.configValues.browse.databaseFilename = message.value;
                break;
        }

        this.configValuesChanged.fire();
        this.logTelemetryForElement(message.key);
    }

    private logTelemetryForElement(elementId: string): void {
        if (this.telemetry[elementId] === undefined) {
            this.telemetry[elementId] = 0;
        }
        this.telemetry[elementId]++;
    }

    private initializeBrowseProperties(): void {
        if (this.configValues.browse === undefined) {
            this.configValues.browse = {};
        }
    }

    private getHtml(): string {
        let content: string | undefined;
        content = fs.readFileSync(util.getExtensionFilePath("ui/settings.html")).toString();

        content = content.replace(
            /{{root}}/g,
            vscode.Uri.file(util.extensionPath)
            .with({ scheme: 'vscode-resource' })
            .toString());

        content = content.replace(
            /{{nonce}}/g,
            this.getNonce());

        return content;
    }

    private getNonce(): string {
        let nonce: string;
        const possible: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i: number = 0; i < 32; i++) {
            nonce += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return nonce;
    }
}
