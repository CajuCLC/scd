/**
 * Copyright © Magento, Inc. All rights reserved.
 * See COPYING.txt for license details.
 */

// TODO: Remove the fs reads from this file, switch to a tree transformer
// (like the less implementation), and update themeTreeBuilder to collect
// require configs

import { join } from 'path';
import { promises as fs } from 'fs';
import { flatten } from './flatten';
import { Theme, Module, Components } from './types';
import { getThemeHierarchy } from './getThemeHierarchy';

const FILE_NAME = 'requirejs-config.js';
/**
 * @summary Generate a combined RequireJS config file
 * @see https://devdocs.magento.com/guides/v2.3/javascript-dev-guide/javascript/js-resources.html#m2devgde-js-resources-mapping
 * @todo Check if `enabledModules` from app/etc/config.php is actually in proper module sequence order
 *       since we implicitly rely on it to get the order of requirejs-configs correct
 */
export async function generateRequireConfig(
    root: string,
    theme: Theme,
    components: Components,
    enabledModules: string[],
) {
    const themeHierarchy = getThemeHierarchy(theme, components.themes);
    const [moduleConfigs, themeConfigs] = await Promise.all([
        getConfigsFromModules(
            root,
            themeHierarchy,
            components.modules,
            enabledModules,
        ),
        getConfigsFromThemes(root, themeHierarchy),
    ]);

    return compileConfigs(moduleConfigs.concat(themeConfigs));
}

/**
 * @summary Find all RequireJS configs for enabled modules
 */
async function getConfigsFromModules(
    root: string,
    themeHierarchy: Theme[],
    modules: Record<string, Module>,
    enabledModules: string[],
) {
    const configPath = (dir: string, area: string) => {
        return join(dir, 'view', area, FILE_NAME);
    };
    const [theme] = themeHierarchy.slice(-1);
    const pendingConfigs = enabledModules.map(async (modName: string) => {
        const mod = modules[modName];
        const areaPath = configPath(mod.pathFromStoreRoot, theme.area);
        const basePath = configPath(mod.pathFromStoreRoot, 'base');

        const [areaConfig, baseConfig] = await Promise.all([
            safeReadFile(join(root, areaPath)),
            safeReadFile(join(root, basePath)),
        ]);

        return [
            { source: areaConfig, pathFromStoreRoot: areaPath },
            { source: baseConfig, pathFromStoreRoot: basePath },
        ];
    });

    return flatten(await Promise.all(pendingConfigs));
}

/**
 * @summary Find all RequireJS configs for current theme
 *          and all ancestor themes. Note that, for "module context"
 *          configs (Vendor_Module), only the `Magento_Theme` dir is supported
 */
async function getConfigsFromThemes(root: string, themeHierarchy: Theme[]) {
    const pendingMagentoThemeCtxConfigs = themeHierarchy.map(async t => {
        const path = join(t.pathFromStoreRoot, 'Magento_Theme', FILE_NAME);
        const source = await safeReadFile(join(root, path));
        return { source, pathFromStoreRoot: path };
    });

    const pendingThemeRootConfigs = themeHierarchy.map(async t => {
        const path = join(t.pathFromStoreRoot, FILE_NAME);
        const source = await safeReadFile(join(root, path));
        return { source, pathFromStoreRoot: path };
    });

    return Promise.all([
        ...pendingMagentoThemeCtxConfigs,
        ...pendingThemeRootConfigs,
    ]);
}

type RequireConfig = {
    source: string;
    pathFromStoreRoot: string;
};

/**
 * @summary Combine all configs into a single asset,
 *          copying IIFE-wrapping from Magento core implementation
 */
function compileConfigs(configs: RequireConfig[]): string {
    return configs.reduce((output, conf) => {
        if (!conf.source) return output;
        const str = `(function() {
    /* Source: ${conf.pathFromStoreRoot} */
    ${conf.source}
    require.config(config);
});\n\n`;
        return output + str;
    }, '');
}

/**
 * @summary Reads a file, and returns the provided default value
 *          when the file can't be accessed
 */
const safeReadFile = (path: string) =>
    fs.readFile(path, 'utf8').catch(() => '');
