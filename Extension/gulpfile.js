/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const env = require('gulp-env')
const tslint = require('gulp-tslint');
const mocha = require('gulp-mocha');
const fs = require('fs');
const optionsSchemaGenerator = require('./out/tools/GenerateOptionsSchema');
const nls = require('vscode-nls-dev');

gulp.task('unitTests', (done) => {
    env.set({
            CODE_TESTS_PATH: "./out/test/unitTests",
        });

    return gulp.src('./test/runVsCodeTestsWithAbsolutePaths.js', {read: false})
        .pipe(mocha({ ui: "tdd" }))
        .once('error', err => {
            done();
            process.exit(1);
        })
        .once('end', () => {
            done();
            process.exit();
        });
});

/// Misc Tasks
const allTypeScript = [
    'src/**/*.ts',
    '!**/*.d.ts',
    '!**/typings**'
];

const lintReporter = (output, file, options) => {
    //emits: src/helloWorld.c:5:3: warning: implicit declaration of function ‘prinft’
    var relativeBase = file.base.substring(file.cwd.length + 1).replace('\\', '/');
    output.forEach(e => {
        var message = relativeBase + e.name + ':' + (e.startPosition.line + 1) + ':' + (e.startPosition.character + 1) + ': ' + e.failure;
        console.log('[tslint] ' + message);
    });
};

gulp.task('tslint', () => {
    return gulp.src(allTypeScript)
        .pipe(tslint({
            program: require('tslint').Linter.createProgram("./tsconfig.json"),
            configuration: "./tslint.json"
        }))
        .pipe(tslint.report(lintReporter, {
            summarizeFailureOutput: false,
            emitError: false
        }))
});

gulp.task('pr-check', (done) => {
    const packageJson = JSON.parse(fs.readFileSync('./package.json').toString());
    if (packageJson.activationEvents.length !== 1 && packageJson.activationEvents[0] !== '*') {
        console.log('Please make sure to not check in package.json that has been rewritten by the extension activation. If you intended to have changes in package.json, please only check-in your changes. If you did not, please run `git checkout -- package.json`.');
        done();
        process.exit(1);
    }

    done();
});

gulp.task('generateOptionsSchema', (done) => {
    optionsSchemaGenerator.generateOptionsSchema();
    done();
});

// If all VS Code languages are support you can use nls.coreLanguages
const languages = [
    { folderName: 'it', id: 'it' },
    { folderName: 'zh-cn', id: 'zh-cn' }
];

const generatedAdditionalLocFiles = () => {
    return gulp.src(['package.nls.json'])
        .pipe(nls.createAdditionalLanguageFiles(languages, 'loc'))
        .pipe(gulp.dest('.'));
};

const generatedSrcLocFiles = () => {
    return gulp.src(['./out/loc/resources.js'])
        .pipe(nls.rewriteLocalizeCalls())
        .pipe(nls.createAdditionalLanguageFiles(languages, 'loc', 'src'))
        .pipe(gulp.dest('out/loc'));
};

gulp.task('generateLocalizationFiles', gulp.series(generatedAdditionalLocFiles, generatedSrcLocFiles));
